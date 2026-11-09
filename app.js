const $ = (selector) => document.querySelector(selector);
const SKILL_URL = new URL("./skills/gold-ema-pullback.json", document.baseURI);
const TIMEFRAMES = [
  { id: "MN1", label: "Monthly", role: "Major trend", weight: 5, group: "HIGHER" },
  { id: "W1", label: "Weekly", role: "Major structure", weight: 4, group: "HIGHER" },
  { id: "D1", label: "Daily", role: "Swing bias", weight: 3, group: "HIGHER" },
  { id: "H4", label: "4 Hour", role: "Trend context", weight: 2, group: "HIGHER" },
  { id: "H1", label: "1 Hour", role: "Session context", weight: 1, group: "HIGHER" },
  { id: "M15", label: "15 Minute", role: "Setup", weight: 0, group: "ENTRY" },
  { id: "M5", label: "5 Minute", role: "Confirmation", weight: 0, group: "ENTRY" },
  { id: "M1", label: "1 Minute", role: "Precision", weight: 0, group: "ENTRY" },
];
const timeframeState = new Map(TIMEFRAMES.map((frame) => [frame.id, { frame, file: null, image: null, candles: [], result: null }]));
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
  $("#session-summary").textContent = message;
}

function renderTimeframeSlots() {
  $("#timeframe-slots").innerHTML = TIMEFRAMES.map((frame) => `
    <article class="timeframe-slot" data-slot="${frame.id}">
      <header class="slot-heading"><div><span class="timeframe-code">${frame.id}</span><div><h3>${frame.label}</h3><small>${frame.role}</small></div></div><span class="slot-group">${frame.group}</span></header>
      <label class="slot-upload" for="file-${frame.id}"><input id="file-${frame.id}" data-timeframe="${frame.id}" type="file" accept="image/*" capture="environment" /><span>＋</span><strong>Upload / take photo</strong></label>
      <canvas id="canvas-${frame.id}" class="slot-canvas" aria-label="${frame.label} MT5 chart with local conditional levels" hidden></canvas>
      <p id="status-${frame.id}" class="slot-status">Waiting for image</p>
    </article>`).join("");
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
      emaDirection: "neutral",
      structureDirection: "neutral",
      candlesDetected: candles.length,
      emaDirection: "neutral",
      structureDirection: "neutral",
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
    emaDirection,
    structureDirection: structure.direction,
    candlesDetected: count,
    emaDirection,
    structureDirection: structure.direction,
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

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This browser could not decode the selected image.")); };
    image.src = url;
  });
}

function drawImageToCanvas(image, canvas) {
  const scale = Math.min(1, 1800 / image.width, 1400 / image.height);
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function updateSlotStatus(frame, message) {
  $(`#status-${frame}`).textContent = message;
}

async function analyzeTimeframe(frameId, file) {
  const slot = timeframeState.get(frameId);
  slot.file = file;
  slot.result = null;
  slot.candles = [];
  slot.image = null;
  const canvas = $(`#canvas-${frameId}`);
  canvas.hidden = false;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  updateSlotStatus(frameId, "Reading screenshot locally…");
  $("#session-summary").textContent = `Updating ${frameId}; all other timeframe images are being kept.`;
  try {
    if (!strategySkill) throw new Error("The local strategy file did not load. Check the skills folder.");
    const image = await decodeImage(file);
    slot.image = image;
    const { context } = drawImageToCanvas(image, canvas);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    slot.candles = findColoredCandles(imageData, canvas.width, canvas.height);
    slot.result = analyzeCandles(slot.candles, strategySkill, canvas.width);
    updateSlotStatus(frameId, `${slot.candles.length} candles · EMA ${slot.result.emaDirection} · structure ${slot.result.structureDirection} · ${slot.result.direction}`);
    renderSession();
  } catch (error) {
    slot.image = null;
    updateSlotStatus(frameId, error.message || "Could not read this image locally.");
    renderSession();
  }
}

function renderSession() {
  const loaded = TIMEFRAMES.map((frame) => ({ frame, slot: timeframeState.get(frame.id) })).filter(({ slot }) => slot.result);
  const higher = loaded.filter(({ frame }) => frame.group === "HIGHER");
  const lower = loaded.filter(({ frame }) => frame.group === "ENTRY");
  const votes = higher.filter(({ slot }) => slot.result.emaDirection !== "neutral" && slot.result.emaDirection === slot.result.structureDirection);
  const longWeight = votes.filter(({ slot }) => slot.result.emaDirection === "long").reduce((sum, { frame }) => sum + frame.weight, 0);
  const shortWeight = votes.filter(({ slot }) => slot.result.emaDirection === "short").reduce((sum, { frame }) => sum + frame.weight, 0);
  const bias = longWeight > shortWeight ? "long" : shortWeight > longWeight ? "short" : "neutral";
  const matching = lower.filter(({ slot }) => slot.result.direction.startsWith(bias.toUpperCase()) && bias !== "neutral");
  const opposing = lower.filter(({ slot }) => slot.result.direction.startsWith(bias === "long" ? "SHORT" : "LONG") && bias !== "neutral");
  let stateText = "WAITING FOR CHARTS";
  let summary = "Upload higher-timeframe charts to establish context, then M15/M5/M1 for entry confirmation.";
  if (!higher.length) {
    stateText = "ADD HIGHER TIMEFRAMES";
  } else if (!votes.length || bias === "neutral") {
    stateText = "WAIT · HTF STRUCTURE UNCLEAR";
    summary = `Loaded ${higher.length} higher-timeframe chart(s), but their EMA and valid-swing biases do not agree.`;
  } else if (opposing.length) {
    stateText = "WAIT · LOWER-TF CONFLICT";
    summary = `${bias.toUpperCase()} higher-timeframe bias conflicts with ${opposing.map(({ frame }) => frame.id).join(", ")} setup(s).`;
  } else if (matching.length) {
    stateText = `${bias.toUpperCase()} · ${matching.map(({ frame }) => frame.id).join(" / ")} CONFIRM`;
    summary = `${bias.toUpperCase()} higher-timeframe bias is confirmed by ${matching.map(({ frame }) => frame.id).join(", ")}. Verify the conditional levels on those images.`;
  } else {
    stateText = `${bias.toUpperCase()} BIAS · WAIT FOR ENTRY`;
    summary = `Higher timeframes lean ${bias.toUpperCase()}; waiting for an aligned M15, M5, or M1 setup.`;
  }
  $("#session-bias").textContent = stateText;
  $("#session-summary").textContent = `${summary} Higher frames: ${longWeight} long weight / ${shortWeight} short weight.`;
  $("#session-trades").innerHTML = loaded.map(({ frame, slot }) => `<div class="session-row"><strong>${frame.id}</strong><span>${slot.result.direction}</span><small>${slot.result.candlesDetected} candles · EMA ${slot.result.emaDirection} · structure ${slot.result.structureDirection}</small></div>`).join("") || "";
  for (const { frame, slot } of loaded) {
    const canvas = $(`#canvas-${frame.id}`);
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(slot.image, 0, 0, canvas.width, canvas.height);
    const aligned = matching.some((item) => item.frame.id === frame.id);
    const result = { ...slot.result, direction: aligned ? slot.result.direction : "WAIT" };
    drawPlanOverlays(context, canvas.width, canvas.height, result);
  }
}

function start() {
  renderTimeframeSlots();
  loadStrategySkill().then(renderSession).catch((error) => {
    $("#skill-status").textContent = "RULES NOT LOADED";
    $("#session-summary").textContent = error.message;
  });
  $("#timeframe-slots").addEventListener("change", (event) => {
    const frameId = event.target.dataset.timeframe;
    if (frameId && event.target.files?.[0]) analyzeTimeframe(frameId, event.target.files[0]);
    if (event.target.type === "file") event.target.value = "";
  });
  $("#timeframe-slots").addEventListener("dragover", (event) => {
    if (event.target.closest(".timeframe-slot")) event.preventDefault();
  });
  $("#timeframe-slots").addEventListener("drop", (event) => {
    const slot = event.target.closest("[data-slot]");
    if (!slot) return;
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) analyzeTimeframe(slot.dataset.slot, file);
  });
  $("#new-session").addEventListener("click", () => {
    for (const frame of TIMEFRAMES) {
      timeframeState.set(frame.id, { frame, file: null, image: null, candles: [], result: null });
      $(`#canvas-${frame.id}`).hidden = true;
      $(`#canvas-${frame.id}`).width = 0;
      $(`#canvas-${frame.id}`).height = 0;
      updateSlotStatus(frame.id, "Waiting for image");
      $(`#file-${frame.id}`).value = "";
    }
    renderSession();
    $("#session-bias").textContent = "NEW SESSION";
    $("#session-summary").textContent = "Upload upper timeframes first; lower-timeframe replacements will keep these charts.";
  });
}

start();
