const $ = (selector) => document.querySelector(selector);
const SKILL_URL = new URL("./skills/gold-ema-pullback.json", document.baseURI);
let currentImage = null;
let previewUrl = null;
let strategySkill = null;

async function loadStrategySkill() {
  const response = await fetch(SKILL_URL);
  if (!response.ok) throw new Error("Could not load the saved strategy file.");
  strategySkill = await response.json();
  $("#strategy-title").textContent = strategySkill.name;
  $("#skill-status").textContent = "RULES LOADED";
  const rules = [
    ["LONG", `${strategySkill.trend_filter.long}; ${strategySkill.long_setup.pullback} ${strategySkill.long_setup.confirmation} Entry ${strategySkill.long_setup.entry}`],
    ["SHORT", `${strategySkill.trend_filter.short}; ${strategySkill.short_setup.pullback} ${strategySkill.short_setup.confirmation} Entry ${strategySkill.short_setup.entry}`],
    ["STOP", `${strategySkill.long_setup.stop_loss} The short-side rule is inverse.`],
    ["TARGET", strategySkill.long_setup.take_profit],
  ];
  $("#skill-rules").innerHTML = rules.map(([label, text]) => `<p><b>${label}</b> ${escapeHtml(text)}</p>`).join("");
  const sources = strategySkill.references.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>`).join(" · ");
  $("#skill-description").textContent = `${strategySkill.description} ${strategySkill.performance_note}`;
  $("#skill-description").insertAdjacentHTML("beforeend", ` Sources: ${sources}`);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function setStatus(message) {
  $("#analysis-status").textContent = message;
}

function previewImage(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $("#selected-image").hidden = false;
  $("#image-name").textContent = file.name || "Chart image";
  $("#image-size").textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  const preview = $("#image-preview");
  preview.hidden = false;
  preview.src = previewUrl;
  preview.onerror = () => { preview.hidden = true; };
}

function candleColorDirection(red, green, blue) {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const chroma = maximum - minimum;
  if (maximum < 70 || chroma < 18) return 0;
  let hue;
  if (maximum === red) hue = 60 * (((green - blue) / chroma) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / chroma + 2);
  else hue = 60 * ((red - green) / chroma + 4);
  if (hue < 0) hue += 360;
  return hue >= 65 && hue < 260 ? 1 : -1;
}

function findColoredCandles(imageData, width, height) {
  const columns = Array.from({ length: width }, () => ({ minY: height, maxY: -1, bullish: 0, bearish: 0 }));
  const pixels = imageData.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const direction = candleColorDirection(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      if (!direction) continue;
      columns[x].minY = Math.min(columns[x].minY, y);
      columns[x].maxY = Math.max(columns[x].maxY, y);
      columns[x][direction > 0 ? "bullish" : "bearish"] += 1;
    }
  }

  const candles = [];
  let cluster = null;
  const finish = () => {
    if (!cluster) return;
    const span = cluster.last - cluster.first + 1;
    const pixelHeight = cluster.maxY - cluster.minY;
    const total = cluster.bullish + cluster.bearish;
    if (span <= Math.max(18, width * 0.018) && pixelHeight >= 4 && total >= span * 2) {
      const bullish = cluster.bullish > cluster.bearish;
      candles.push({
        high: height - cluster.minY,
        low: height - cluster.maxY,
        open: bullish ? height - cluster.maxY : height - cluster.minY,
        close: bullish ? height - cluster.minY : height - cluster.maxY,
        bullish,
      });
    }
    cluster = null;
  };

  columns.forEach((column, x) => {
    if (!column.bullish && !column.bearish) {
      if (cluster && x - cluster.last > 2) finish();
      return;
    }
    if (cluster && x - cluster.last > 2) finish();
    if (!cluster) cluster = { first: x, last: x, minY: height, maxY: 0, bullish: 0, bearish: 0 };
    cluster.last = x;
    cluster.minY = Math.min(cluster.minY, column.minY);
    cluster.maxY = Math.max(cluster.maxY, column.maxY);
    cluster.bullish += column.bullish;
    cluster.bearish += column.bearish;
  });
  finish();
  return candles.slice(-180);
}

function emaSeries(values, period) {
  const multiplier = 2 / (period + 1);
  return values.reduce((result, value, index) => {
    result.push(index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier));
    return result;
  }, []);
}

function averageTrueRange(candles, period = 14) {
  const recent = candles.slice(-period);
  const ranges = recent.map((candle, index) => {
    const previous = recent[index - 1] || candles[candles.length - period + index - 1];
    return previous ? Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close)) : candle.high - candle.low;
  });
  return ranges.reduce((sum, range) => sum + range, 0) / Math.max(ranges.length, 1);
}

function analyzeCandles(candles, skill) {
  if (candles.length < skill.image_reader.minimum_candles) {
    return {
      direction: "WAIT",
      confidence: "LOW · LOCAL IMAGE READ",
      visualSummary: `Detected ${candles.length} candle groups. At least ${skill.image_reader.minimum_candles} are needed to attempt the local EMA20/50 interpretation. The uploaded image was still scanned, but there is too little candle history to apply the strategy.`,
      currentPrice: null,
      entry: "Not readable from image",
      stopLoss: "Not readable from image",
      takeProfit: "Not readable from image",
      caveats: ["No OCR is used; exact quoted prices are not extracted."],
    };
  }
  const closes = candles.map((candle) => candle.close);
  const fast = emaSeries(closes, skill.trend_filter.fast_ema_period);
  const slow = emaSeries(closes, skill.trend_filter.slow_ema_period);
  const atr = averageTrueRange(candles, 14);
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const recentPullbacks = candles.slice(-7, -1).map((candle, offset) => ({ candle, index: candles.length - 7 + offset }));
  const longPullback = recentPullbacks.some(({ candle, index }) => Math.abs(candle.low - fast[index]) <= atr * 0.75);
  const shortPullback = recentPullbacks.some(({ candle, index }) => Math.abs(candle.high - fast[index]) <= atr * 0.75);
  const longTrend = fast.at(-1) > slow.at(-1);
  const shortTrend = fast.at(-1) < slow.at(-1);
  const longConfirmation = latest.bullish && latest.close > previous.high;
  const shortConfirmation = !latest.bullish && latest.close < previous.low;
  const longSwing = Math.min(...candles.slice(-7, -1).map((candle) => candle.low));
  const shortSwing = Math.max(...candles.slice(-7, -1).map((candle) => candle.high));
  const longEntry = latest.high;
  const shortEntry = latest.low;
  const longRisk = longEntry - longSwing;
  const shortRisk = shortSwing - shortEntry;
  const longStopOkay = longRisk > 0 && longRisk <= atr * 1.5;
  const shortStopOkay = shortRisk > 0 && shortRisk <= atr * 1.5;
  let direction = "WAIT";
  let entry = "No valid entry";
  let stopLoss = "No valid stop";
  let takeProfit = "No valid target";
  if (longTrend && longPullback && longConfirmation && longStopOkay) {
    direction = "LONG CANDIDATE";
    entry = "Break above confirmation candle high";
    stopLoss = "Below recent pullback swing";
    takeProfit = "2R above entry";
  } else if (shortTrend && shortPullback && shortConfirmation && shortStopOkay) {
    direction = "SHORT CANDIDATE";
    entry = "Break below confirmation candle low";
    stopLoss = "Above recent pullback swing";
    takeProfit = "2R below entry";
  }
  const visualTrend = longTrend ? "EMA20 is above EMA50 in the detected candle sequence." : shortTrend ? "EMA20 is below EMA50 in the detected candle sequence." : "The EMA20/EMA50 relationship is mixed.";
  const checks = direction === "WAIT"
    ? `Trend filter: ${longTrend || shortTrend ? "pass" : "fail"}; pullback: ${longPullback || shortPullback ? "detected" : "not detected"}; candle confirmation: ${longConfirmation || shortConfirmation ? "detected" : "not detected"}; stop/target filter: not fully met.`
    : "Trend, pullback, confirmation candle, 1.5 ATR stop limit, and 2R visible-range checks passed.";
  return {
    direction,
    confidence: "LOW · LOCAL IMAGE READ",
    visualSummary: `${visualTrend} Detected ${candles.length} colored candle groups. ${checks}`,
    currentPrice: null,
    entry,
    stopLoss,
    takeProfit,
    caveats: ["This rule-based image scan estimates candle colors and positions. It does not OCR prices or reliably distinguish every MT5 theme."],
  };
}

function showResult(result) {
  $("#result-direction").textContent = result.direction;
  $("#result-direction").className = `result-direction ${result.direction.startsWith("LONG") ? "long" : result.direction.startsWith("SHORT") ? "short" : "wait"}`;
  $("#result-confidence").textContent = result.confidence;
  $("#result-summary").textContent = result.visualSummary;
  $("#result-price").textContent = "Not OCR'd locally";
  $("#result-entry").textContent = result.entry;
  $("#result-stop").textContent = result.stopLoss;
  $("#result-target").textContent = result.takeProfit;
  $("#result-caveats").textContent = result.caveats.join(" ");
  $("#analysis-result").hidden = false;
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This browser could not decode the selected image.")); };
    image.src = url;
  });
}

function drawImageToCanvas(image) {
  const scale = Math.min(1, 1800 / image.width, 1400 / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function displayImage(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $("#selected-image").hidden = false;
  $("#image-name").textContent = file.name || "Chart image";
  $("#image-size").textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  const preview = $("#image-preview");
  preview.hidden = false;
  preview.src = previewUrl;
  preview.onerror = () => { preview.hidden = true; };
}

async function analyzeImage(file) {
  currentImage = file;
  displayImage(file);
  $("#analysis-result").hidden = true;
  $("#retry-analysis").hidden = true;
  $("#upload-dropzone").classList.add("busy");
  $("#analysis-status").textContent = "Loading local strategy file and reading image pixels…";
  try {
    if (!strategySkill) throw new Error("The local strategy file did not load. Check the skills folder.");
    const image = await decodeImage(file);
    const { canvas, context } = drawImageToCanvas(image);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const candles = findColoredCandles(imageData, canvas.width, canvas.height);
    showResult(analyzeCandles(candles, strategySkill));
    $("#analysis-status").textContent = "Local strategy interpretation complete. No image or API request was sent.";
  } catch (error) {
    $("#analysis-status").textContent = error.message || "Could not analyze this image locally.";
    $("#retry-analysis").hidden = false;
  } finally {
    $("#upload-dropzone").classList.remove("busy");
  }
}

function handleFiles(files) {
  const file = files?.[0];
  if (file) analyzeImage(file);
}

function start() {
  fetch(SKILL_URL)
    .then((response) => {
      if (!response.ok) throw new Error("Could not load local strategy rules.");
      return response.json();
    })
    .then((skill) => {
      strategySkill = skill;
      const rules = [
        ["LONG", `${skill.trend_filter.long}; ${skill.long_setup.pullback} ${skill.long_setup.confirmation} Entry ${skill.long_setup.entry}`],
        ["SHORT", `${skill.trend_filter.short}; ${skill.short_setup.pullback} ${skill.short_setup.confirmation} Entry ${skill.short_setup.entry}`],
        ["STOP", skill.long_setup.stop_loss],
        ["TARGET", skill.long_setup.take_profit],
      ];
      $("#strategy-title").textContent = skill.name;
      $("#skill-status").textContent = "RULES LOADED";
      $("#skill-rules").innerHTML = rules.map(([label, text]) => `<p><b>${escapeHtml(label)}</b> ${escapeHtml(text)}</p>`).join("");
      $("#skill-description").textContent = `${skill.description} ${skill.performance_note}`;
      $("#skill-sources").innerHTML = skill.references.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>`).join(" · ");
    })
    .catch((error) => {
      $("#skill-status").textContent = "RULES NOT LOADED";
      $("#analysis-status").textContent = error.message;
    });
}

$("#chart-file").addEventListener("change", (event) => {
  handleFiles(event.target.files);
  event.target.value = "";
});
$("#retry-analysis").addEventListener("click", () => {
  if (currentImage) analyzeImage(currentImage);
});

const dropzone = $("#upload-dropzone");
for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  handleFiles(event.dataTransfer.files);
});

start();
