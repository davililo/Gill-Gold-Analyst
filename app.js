const $ = (selector) => document.querySelector(selector);
const SKILL_URL = new URL("./skills/gold-ema-pullback.json", document.baseURI);
let currentImage = null;
let strategySkill = null;

async function loadStrategySkill() {
  const response = await fetch(SKILL_URL);
  if (!response.ok) throw new Error("Could not load the saved strategy file.");
  strategySkill = await response.json();
  $("#strategy-title").textContent = strategySkill.combination.name;
  $("#skill-status").textContent = `${strategySkill.components.length} RULES LOADED`;
  const structure = strategySkill.components.find((component) => component.id === "valid-structure-zones");
  const rules = [
    ["BIAS", "EMA trend and valid higher-high/higher-low or lower-low/lower-high structure must agree."],
    ["ZONE", "Mark the last base candle before displacement; wait for price to revisit the matching supply/demand zone."],
    ["ENTRY", "Zone retest plus the EMA pullback candle confirmation."],
    ["RISK", "Stop beyond zone; target the recent swing only when reward is at least 2.5R."],
  ];
  if (!structure) throw new Error("Combined structure rules are missing from the skill file.");
  $("#skill-rules").innerHTML = rules.map(([label, text]) => `<p><b>${label}</b> ${escapeHtml(text)}</p>`).join("");
  $("#skill-description").textContent = strategySkill.combination.conflict;
  $("#skill-sources").innerHTML = strategySkill.references.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>`).join(" · ");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function setStatus(message) {
  $("#analysis-status").textContent = message;
}

function previewImage(file) {
  $("#selected-image").hidden = false;
  $("#image-name").textContent = file.name || "Chart image";
  $("#image-size").textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  const canvas = $("#image-preview");
  canvas.width = 0;
  canvas.height = 0;
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
        x: (cluster.first + cluster.last) / 2,
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

function findSwingPoints(candles, radius = 2) {
  const highs = [];
  const lows = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const neighborhood = candles.slice(index - radius, index + radius + 1);
    const candle = candles[index];
    if (neighborhood.every((item, offset) => offset === radius || candle.high > item.high)) highs.push({ index, price: candle.high });
    if (neighborhood.every((item, offset) => offset === radius || candle.low < item.low)) lows.push({ index, price: candle.low });
  }
  return { highs, lows };
}

function determineStructure(candles, swings) {
  const highPairs = swings.highs.slice(-2);
  const lowPairs = swings.lows.slice(-2);
  if (highPairs.length < 2 || lowPairs.length < 2) return { direction: "neutral", validLow: null, validHigh: null, swings };
  const rising = highPairs[1].price > highPairs[0].price && lowPairs[1].price > lowPairs[0].price;
  const falling = highPairs[1].price < highPairs[0].price && lowPairs[1].price < lowPairs[0].price;
  let direction = rising ? "long" : falling ? "short" : "neutral";
  const validLows = swings.lows.filter((low) => {
    const priorHigh = swings.highs.filter((high) => high.index < low.index).at(-1);
    return priorHigh && candles.slice(low.index + 1).some((candle) => candle.high > priorHigh.price);
  });
  const validHighs = swings.highs.filter((high) => {
    const priorLow = swings.lows.filter((low) => low.index < high.index).at(-1);
    return priorLow && candles.slice(high.index + 1).some((candle) => candle.low < priorLow.price);
  });
  const validLow = validLows.at(-1) || null;
  const validHigh = validHighs.at(-1) || null;
  const latest = candles.at(-1);
  if (direction === "long" && validLow && latest.close < validLow.price) direction = "short";
  else if (direction === "short" && validHigh && latest.close > validHigh.price) direction = "long";
  if (direction === "neutral") {
    if (latest.close > highPairs[1].price) direction = "long";
    else if (latest.close < lowPairs[1].price) direction = "short";
  }
  return { direction, validLow, validHigh, swings };
}

function findSupplyDemandZones(candles, atr) {
  const zones = { demand: [], supply: [] };
  for (let index = 2; index < candles.length - 1; index += 1) {
    const base = candles[index];
    const consolidation = candles.slice(index - 2, index + 1);
    const baseIsQuiet = consolidation.every((candle) => Math.abs(candle.close - candle.open) <= atr * 0.8);
    const impulse = candles[index + 1];
    const displacement = Math.abs(impulse.close - impulse.open) >= atr * 1.5;
    if (!baseIsQuiet || !displacement) continue;
    if (impulse.bullish && impulse.close > base.high) {
      zones.demand.push({ index, x: base.x, low: base.low, high: base.high });
    }
    if (!impulse.bullish && impulse.close < base.low) {
      zones.supply.push({ index, x: base.x, low: base.low, high: base.high });
    }
  }
  return zones;
}

function makeConditionalPlan(direction, zone, candles, atr, swings, canvasWidth) {
  const bullish = direction === "long";
  const recentBars = candles.slice(-12);
  const fallback = bullish
    ? { index: candles.length - recentBars.length + recentBars.reduce((best, candle, offset, list) => candle.low < list[best].low ? offset : best, 0), low: Math.min(...recentBars.map((candle) => candle.low)), high: recentBars.reduce((best, candle) => candle.low < best.low ? candle : best).high }
    : { index: candles.length - recentBars.length + recentBars.reduce((best, candle, offset, list) => candle.high > list[best].high ? offset : best, 0), high: Math.max(...recentBars.map((candle) => candle.high)), low: recentBars.reduce((best, candle) => candle.high > best.high ? candle : best).low };
  const referenceZone = zone || { ...fallback, x: candles[fallback.index]?.x || candles.at(-1).x, fallback: true };
  const entry = bullish ? referenceZone.high : referenceZone.low;
  const stop = bullish ? referenceZone.low - atr * 0.12 : referenceZone.high + atr * 0.12;
  const risk = Math.abs(entry - stop);
  const candidates = bullish
    ? swings.highs.filter((point) => point.index > referenceZone.index && point.price > entry)
    : swings.lows.filter((point) => point.index > referenceZone.index && point.price < entry);
  const swingTarget = candidates.at(-1)?.price;
  const projectedTarget = bullish ? entry + risk * 2.5 : entry - risk * 2.5;
  const target = swingTarget ?? projectedTarget;
  return {
    direction,
    zone: referenceZone,
    entry,
    stop,
    target,
    targetIsProjected: swingTarget === undefined,
    xStart: Math.max(0, Math.min(canvasWidth, referenceZone.x)),
    conditional: true,
  };
}

function analyzeCandles(candles, skill, canvasWidth) {
  if (candles.length < skill.image_reader.minimum_candles) {
    const atr = Math.max(averageTrueRange(candles, 14), 1);
    const swings = findSwingPoints(candles);
    const overlays = candles.length
      ? [makeConditionalPlan("long", null, candles, atr, swings, canvasWidth), makeConditionalPlan("short", null, candles, atr, swings, canvasWidth)]
      : [];
    return {
      direction: "WAIT",
      confidence: "LOW · LOCAL PIXEL READ",
      visualSummary: `Detected ${candles.length} candle groups; ${skill.image_reader.minimum_candles} are needed for structure and zone checks. The uploaded image was still scanned.`,
      currentPrice: null,
      entry: overlays.length ? "Conditional long and short swing scenarios" : "No candle locations detected",
      stopLoss: overlays.length ? "Conditional stops beyond recent swings" : "No candle locations detected",
      takeProfit: overlays.length ? "Conditional 2.5R projections" : "No candle locations detected",
      caveats: ["Dashed lines are illustrative scenarios, not trade signals. No OCR is used; exact quoted prices are not extracted."],
      overlays,
    };
  }
  const count = candles.length;
  const maximumStopAtr = skill.combination.maximum_stop_atr;
  const minimumRewardRisk = skill.combination.minimum_reward_risk;
  const atr = averageTrueRange(candles, 14);
  const swings = findSwingPoints(candles);
  const structure = determineStructure(candles, swings);
  const zones = findSupplyDemandZones(candles, atr);
  const closes = candles.map((candle) => candle.close);
  const fast = emaSeries(closes, skill.trend_filter.fast_ema_period);
  const slow = emaSeries(closes, skill.trend_filter.slow_ema_period);
  const emaDirection = fast.at(-1) > slow.at(-1) ? "long" : fast.at(-1) < slow.at(-1) ? "short" : "neutral";
  const latest = candles.at(-1);
  const previous = candles.at(-2) || latest;
  const recent = candles.slice(-7, -1);
  const longPullback = recent.some((candle, offset) => Math.abs(candle.low - fast[count - 7 + offset]) <= atr * 0.75);
  const shortPullback = recent.some((candle, offset) => Math.abs(candle.high - fast[count - 7 + offset]) <= atr * 0.75);
  const longConfirmation = latest.bullish && latest.close > previous.high;
  const shortConfirmation = !latest.bullish && latest.close < previous.low;
  const demandZone = zones.demand.filter((zone) => zone.index < count - 2).at(-1) || null;
  const supplyZone = zones.supply.filter((zone) => zone.index < count - 2).at(-1) || null;
  const demandTouched = demandZone && latest.low <= demandZone.high && latest.high >= demandZone.low;
  const supplyTouched = supplyZone && latest.high >= supplyZone.low && latest.low <= supplyZone.high;
  const longStructure = structure.direction === "long";
  const shortStructure = structure.direction === "short";
  const longStop = demandZone ? demandZone.low - atr * 0.12 : null;
  const shortStop = supplyZone ? supplyZone.high + atr * 0.12 : null;
  const longEntry = demandZone?.high;
  const shortEntry = supplyZone?.low;
  const longRisk = longEntry === undefined ? Infinity : longEntry - longStop;
  const shortRisk = shortEntry === undefined ? Infinity : shortStop - shortEntry;
  const targetHigh = swings.highs.filter((point) => demandZone && point.index > demandZone.index && point.price > longEntry).at(-1)?.price;
  const targetLow = swings.lows.filter((point) => supplyZone && point.index > supplyZone.index && point.price < shortEntry).at(-1)?.price;
  const longRewardRisk = targetHigh === undefined ? 0 : (targetHigh - longEntry) / Math.max(longRisk, 0.001);
  const shortRewardRisk = targetLow === undefined ? 0 : (shortEntry - targetLow) / Math.max(shortRisk, 0.001);
  const longEmaComponent = emaDirection === "long" && longPullback && longConfirmation;
  const shortEmaComponent = emaDirection === "short" && shortPullback && shortConfirmation;
  const longActive = longEmaComponent && longStructure && demandTouched && longRisk > 0 && longRisk <= atr * maximumStopAtr && longRewardRisk >= minimumRewardRisk;
  const shortActive = shortEmaComponent && shortStructure && supplyTouched && shortRisk > 0 && shortRisk <= atr * maximumStopAtr && shortRewardRisk >= minimumRewardRisk;
  const scenarioDirection = structure.direction !== "neutral" ? structure.direction : emaDirection;
  const scenarios = [];
  if (scenarioDirection === "long" || scenarioDirection === "short") {
    const zone = scenarioDirection === "long" ? demandZone : supplyZone;
    scenarios.push(makeConditionalPlan(scenarioDirection, zone, candles, atr, swings, canvasWidth));
  } else {
    scenarios.push(makeConditionalPlan("long", demandZone, candles, atr, swings, canvasWidth));
    scenarios.push(makeConditionalPlan("short", supplyZone, candles, atr, swings, canvasWidth));
  }
  const activeDirection = longActive ? "LONG CANDIDATE" : shortActive ? "SHORT CANDIDATE" : "WAIT";
  const activePlan = longActive ? scenarios.find((plan) => plan.direction === "long") : shortActive ? scenarios.find((plan) => plan.direction === "short") : null;
  if (activePlan) activePlan.conditional = false;
  const primaryPlan = activePlan || scenarios[0];
  const checks = `EMA bias: ${emaDirection}; structure: ${structure.direction}; demand retest: ${demandTouched ? "yes" : "no"}; supply retest: ${supplyTouched ? "yes" : "no"}; EMA pullback confirmation: ${longEmaComponent || shortEmaComponent ? "yes" : "no"}; ${minimumRewardRisk}R target: ${longRewardRisk >= minimumRewardRisk || shortRewardRisk >= minimumRewardRisk ? "yes" : "no"}.`;
  return {
    direction: activeDirection,
    confidence: "LOW · LOCAL PIXEL READ",
    visualSummary: `${count} candle groups scanned. ${checks}`,
    currentPrice: null,
    entry: primaryPlan ? `${primaryPlan.conditional ? "Conditional " : "Active setup · "}${primaryPlan.zone.fallback ? "swing-area" : "zone"} retest` : "No swing location detected",
    stopLoss: primaryPlan ? `Beyond ${primaryPlan.zone.fallback ? "swing area" : primaryPlan.direction === "long" ? "demand" : "supply"} zone` : "No swing location detected",
    takeProfit: primaryPlan ? `${primaryPlan.targetIsProjected ? "Projected " : "Recent swing · "}2.5R` : "No swing target detected",
    caveats: ["Dashed chart lines are conditional scenarios while WAIT is shown. No OCR is used; exact dollar prices are not extracted."],
    overlays: scenarios,
  };
}

function drawPlanOverlays(context, width, height, result) {
  if (!result.overlays?.length) return;
  context.save();
  context.font = "bold 11px monospace";
  context.lineWidth = Math.max(2, width / 900);
  for (const plan of result.overlays) {
    const color = plan.direction === "long" ? "#9ee66b" : "#ff8874";
    const zoneTop = Math.max(0, Math.min(height, height - plan.zone.high));
    const zoneBottom = Math.max(0, Math.min(height, height - plan.zone.low));
    context.globalAlpha = 0.18;
    context.fillStyle = color;
    context.fillRect(plan.xStart, zoneTop, Math.max(1, width - plan.xStart), Math.max(2, zoneBottom - zoneTop));
    context.globalAlpha = 1;
    context.strokeStyle = color;
    const conditional = result.direction === "WAIT" || plan.conditional;
    context.setLineDash(conditional ? [8, 6] : []);
    for (const [label, value] of [["ENTRY", plan.entry], ["SL", plan.stop], ["TP", plan.target]]) {
      const y = Math.max(10, Math.min(height - 10, height - value));
      context.beginPath();
      context.moveTo(plan.xStart, y);
      context.lineTo(width, y);
      context.stroke();
      const text = `${plan.direction.toUpperCase()} ${label}${conditional ? " · CONDITIONAL" : ""}`;
      const textWidth = context.measureText(text).width;
      const textX = Math.max(4, width - textWidth - 10);
      context.fillStyle = "#101513e8";
      context.fillRect(textX - 4, y - 10, textWidth + 8, 20);
      context.fillStyle = color;
      context.fillText(text, textX, y + 4);
    }
  }
  context.setLineDash([]);
  context.restore();
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
  const canvas = $("#image-preview");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function displayImage(file) {
  previewImage(file);
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
    const result = analyzeCandles(candles, strategySkill, canvas.width);
    drawPlanOverlays(context, canvas.width, canvas.height, result);
    showResult(result);
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
