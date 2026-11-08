const STORE_KEY = "gill-gold-analyst-v1";
const defaults = [
  { id: "trend", name: "EMA trend structure", type: "trend", enabled: true },
  { id: "momentum", name: "Momentum breakout", type: "momentum", enabled: true },
  { id: "mean", name: "RSI mean reversion", type: "mean", enabled: true },
  { id: "liquidity", name: "Liquidity sweep", type: "liquidity", enabled: true },
];
const state = {
  bars: [],
  source: "NO MARKET DATA",
  dataReady: false,
  timeframe: "1H",
  stopAtr: 1,
  targetR: 2,
  strategyName: "Gill Gold Blend",
  strategyVersion: 1,
  strategies: defaults.map((item) => ({ ...item })),
  outcomes: [],
  currentSignal: null,
};
const $ = (selector) => document.querySelector(selector);
const chart = $("#price-chart");
const chartContext = chart.getContext("2d");
const screenshotCanvas = $("#screenshot-canvas");
const screenshotContext = screenshotCanvas.getContext("2d");
const screenshotState = { image: null, url: null, crop: null, start: null };
const AI_KEY_STORAGE = "gill-gemini-key-session";
let strategyVideoFile = null;
let videoUrl = null;

function getApiKey() {
  return sessionStorage.getItem(AI_KEY_STORAGE) || "";
}

function geminiEndpoint(path) {
  return `https://generativelanguage.googleapis.com/v1beta/${path}`;
}

async function geminiGenerate(parts) {
  const key = getApiKey();
  if (!key) throw new Error("Connect your Google AI Studio key first.");
  const response = await fetch(`${geminiEndpoint("models/gemini-2.5-flash:generateContent")}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || `Gemini request failed (${response.status}).`);
  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned no analysis. Try another image or video.");
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("Gemini returned an unreadable response. Please retry.");
  }
}

async function uploadVideoToGemini(file) {
  const key = getApiKey();
  const mimeType = file.type || "video/mp4";
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(file.size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: file.name } }),
  });
  if (!start.ok) {
    const error = await start.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini video upload failed (${start.status}).`);
  }
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini did not return a video upload URL.");
  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Type": mimeType },
    body: file,
  });
  const uploadResult = await uploaded.json();
  if (!uploaded.ok) throw new Error(uploadResult.error?.message || `Gemini video upload failed (${uploaded.status}).`);
  let uploadedFile = uploadResult.file;
  for (let attempt = 0; uploadedFile?.state === "PROCESSING" && attempt < 60; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const status = await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadedFile.name}?key=${encodeURIComponent(key)}`);
    const statusResult = await status.json();
    if (!status.ok) throw new Error(statusResult.error?.message || "Could not check video processing status.");
    uploadedFile = statusResult;
  }
  if (uploadedFile?.state === "FAILED") throw new Error("Gemini could not process this video format.");
  if (uploadedFile?.state === "PROCESSING") throw new Error("Video is still processing. Try again in a moment.");
  if (!uploadedFile?.uri) throw new Error("Gemini did not return a processed video.");
  return { file_data: { mime_type: uploadedFile.mimeType || mimeType, file_uri: uploadedFile.uri } };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not prepare the selected chart crop."));
    reader.readAsDataURL(blob);
  });
}

if (getApiKey()) $("#gemini-key-state").textContent = "Gemini key is connected for this tab only.";
$("#save-gemini-key").addEventListener("click", () => {
  const key = $("#gemini-api-key").value.trim();
  if (!key) {
    sessionStorage.removeItem(AI_KEY_STORAGE);
    $("#gemini-key-state").textContent = "Gemini key cleared from this tab.";
    return;
  }
  sessionStorage.setItem(AI_KEY_STORAGE, key);
  $("#gemini-api-key").value = "";
  $("#gemini-key-state").textContent = "Gemini key is connected for this tab only.";
});

function readStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (Array.isArray(saved.strategies) && saved.strategies.length) state.strategies = saved.strategies;
    if (Array.isArray(saved.outcomes)) state.outcomes = saved.outcomes;
    if (typeof saved.strategyName === "string") state.strategyName = saved.strategyName;
    if (Number.isInteger(saved.strategyVersion) && saved.strategyVersion > 0) state.strategyVersion = saved.strategyVersion;
  } catch {
    localStorage.removeItem(STORE_KEY);
  }
}

function saveStorage() {
  localStorage.setItem(STORE_KEY, JSON.stringify({ strategies: state.strategies, outcomes: state.outcomes, strategyName: state.strategyName, strategyVersion: state.strategyVersion }));
}

function makeSampleBars(count = 96) {
  let value = 2368;
  let seed = 92017;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const bars = [];
  const start = Date.now() - count * 3600000;
  for (let index = 0; index < count; index += 1) {
    const wave = Math.sin(index / 8) * 0.55 + Math.sin(index / 19) * 0.4;
    const open = value;
    const close = open + wave + (random() - 0.47) * 3.8;
    const high = Math.max(open, close) + random() * 2.4;
    const low = Math.min(open, close) - random() * 2.4;
    bars.push({ time: start + index * 3600000, open, high, low, close, volume: 0 });
    value = close;
  }
  return bars;
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  return values.reduce((result, value, index) => {
    result.push(index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier));
    return result;
  }, []);
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  if (!losses) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function atr(bars, period = 14) {
  const ranges = bars.slice(-period).map((bar, index, recent) => {
    const previous = recent[index - 1] || bars[bars.length - period + index - 1];
    return previous ? Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close)) : bar.high - bar.low;
  });
  return ranges.reduce((sum, range) => sum + range, 0) / Math.max(ranges.length, 1);
}

function calculateFeatures() {
  return calculateFeaturesForBars(getAnalysisBars());
}

function calculateFeaturesForBars(analysisBars) {
  const closes = analysisBars.map((bar) => bar.close);
  const fast = ema(closes, Math.min(9, closes.length));
  const slow = ema(closes, Math.min(21, closes.length));
  const latest = analysisBars.at(-1);
  const previous = analysisBars.at(-2) || latest;
  const currentRsi = rsi(closes);
  const currentAtr = atr(analysisBars);
  const lookback = analysisBars.slice(-21, -1);
  const rangeHigh = Math.max(...lookback.map((bar) => bar.high));
  const rangeLow = Math.min(...lookback.map((bar) => bar.low));
  const upTrend = (fast.at(-1) - slow.at(-1)) / Math.max(currentAtr, 0.01);
  const priorHigh = Math.max(...analysisBars.slice(-7, -1).map((bar) => bar.high));
  const priorLow = Math.min(...analysisBars.slice(-7, -1).map((bar) => bar.low));
  const sweptLow = latest.low < priorLow && latest.close > priorLow;
  const sweptHigh = latest.high > priorHigh && latest.close < priorHigh;
  return { latest, previous, currentRsi, currentAtr, fast, slow, rangeHigh, rangeLow, upTrend, sweptLow, sweptHigh, closes, bars: analysisBars };
}

function getAnalysisBars() {
  const hours = { "1H": 1, "4H": 4, "1D": 24 }[state.timeframe] || 1;
  if (hours === 1) return state.bars;
  const interval = hours * 3600000;
  const grouped = [];
  for (const bar of state.bars) {
    const bucket = Math.floor(bar.time / interval) * interval;
    const last = grouped.at(-1);
    if (!last || last.time !== bucket) {
      grouped.push({ ...bar, time: bucket });
    } else {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume || 0;
    }
  }
  return grouped.length >= 2 ? grouped : state.bars;
}

function rawScore(type, features, params = {}) {
  const { latest, currentRsi, currentAtr, upTrend, rangeHigh, rangeLow, sweptLow, sweptHigh } = features;
  if (type === "rules") {
    const long = evaluateRule(params.longEntry, features);
    const short = evaluateRule(params.shortEntry, features);
    return long === short ? 0 : long ? 1 : -1;
  }
  if (type === "trend") {
    const fast = ema(features.closes, Math.min(params.fastPeriod || 9, features.closes.length)).at(-1);
    const slow = ema(features.closes, Math.min(params.slowPeriod || 21, features.closes.length)).at(-1);
    return Math.max(-1, Math.min(1, ((fast - slow) / Math.max(currentAtr, 0.01)) * 2.2));
  }
  if (type === "momentum") {
    const lookback = Math.max(5, Math.min(params.lookback || 20, features.bars.length - 1));
    const recent = features.bars.slice(-lookback - 1, -1);
    const high = Math.max(...recent.map((bar) => bar.high));
    const low = Math.min(...recent.map((bar) => bar.low));
    if (latest.close > high) return 0.9;
    if (latest.close < low) return -0.9;
    const rangeMid = (high + low) / 2;
    return Math.max(-0.45, Math.min(0.45, ((latest.close - rangeMid) / Math.max(currentAtr * 1.8, 0.01))));
  }
  if (type === "mean") {
    const value = rsi(features.closes, params.rsiPeriod || 14);
    const oversold = params.oversold || 30;
    const overbought = params.overbought || 70;
    if (value <= oversold) return Math.min(1, (oversold - value + 5) / 20);
    if (value >= overbought) return -Math.min(1, (value - overbought + 5) / 20);
    return 0;
  }
  if (type === "liquidity") {
    if (sweptLow) return 1;
    if (sweptHigh) return -1;
    const lowerWick = Math.max(0, Math.min(latest.open, latest.close) - latest.low);
    const upperWick = Math.max(0, latest.high - Math.max(latest.open, latest.close));
    return Math.max(-0.55, Math.min(0.55, (lowerWick - upperWick) / Math.max(currentAtr, 0.01)));
  }
  return 0;
}

function validateRuleTree(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 5) return null;
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    const operator = Array.isArray(node.all) ? "all" : "any";
    const children = node[operator];
    if (!children.length || children.length > 10) return null;
    const validated = children.map((child) => validateRuleTree(child, depth + 1));
    return validated.every(Boolean) ? { [operator]: validated } : null;
  }
  const indicator = String(node.indicator || "").toLowerCase();
  if (indicator === "rsi") {
    const operator = ["lt", "lte", "gt", "gte"].includes(node.operator) ? node.operator : null;
    const period = Number(node.period || 14);
    const value = Number(node.value);
    if (!operator || !Number.isFinite(period) || !Number.isFinite(value) || period < 2 || period > 50 || value < 0 || value > 100) return null;
    return { indicator, operator, period, value };
  }
  if (indicator === "ema_cross") {
    const fast = Number(node.fast || 9);
    const slow = Number(node.slow || 21);
    if (![fast, slow].every(Number.isFinite) || fast < 2 || fast > 100 || slow < 3 || slow > 250 || fast >= slow || !["bullish", "bearish"].includes(node.direction)) return null;
    return { indicator, fast, slow, direction: node.direction };
  }
  if (indicator === "price_ema") {
    const period = Number(node.period || 50);
    if (!Number.isFinite(period) || period < 2 || period > 250 || !["above", "below"].includes(node.direction)) return null;
    return { indicator, period, direction: node.direction };
  }
  if (indicator === "breakout") {
    const period = Number(node.period || 20);
    if (!Number.isFinite(period) || period < 5 || period > 200 || !["above", "below"].includes(node.direction)) return null;
    return { indicator, period, direction: node.direction };
  }
  if (indicator === "macd_cross") {
    if (!["bullish", "bearish"].includes(node.direction)) return null;
    return { indicator, direction: node.direction };
  }
  if (indicator === "candle") {
    const patterns = ["bullish", "bearish", "bullish_engulfing", "bearish_engulfing", "bullish_pinbar", "bearish_pinbar"];
    return patterns.includes(node.pattern) ? { indicator, pattern: node.pattern } : null;
  }
  return null;
}

function evaluateRule(node, features) {
  if (!node) return false;
  if (node.all) return node.all.every((child) => evaluateRule(child, features));
  if (node.any) return node.any.some((child) => evaluateRule(child, features));
  const { bars, closes, latest, previous } = features;
  if (node.indicator === "rsi") {
    const value = rsi(closes, node.period);
    return { lt: value < node.value, lte: value <= node.value, gt: value > node.value, gte: value >= node.value }[node.operator];
  }
  if (node.indicator === "ema_cross") {
    if (closes.length < node.slow + 1) return false;
    const currentFast = ema(closes, node.fast).at(-1);
    const currentSlow = ema(closes, node.slow).at(-1);
    const previousFast = ema(closes.slice(0, -1), node.fast).at(-1);
    const previousSlow = ema(closes.slice(0, -1), node.slow).at(-1);
    return node.direction === "bullish" ? previousFast <= previousSlow && currentFast > currentSlow : previousFast >= previousSlow && currentFast < currentSlow;
  }
  if (node.indicator === "price_ema") {
    const average = ema(closes, node.period).at(-1);
    return node.direction === "above" ? latest.close > average : latest.close < average;
  }
  if (node.indicator === "breakout") {
    const prior = bars.slice(-node.period - 1, -1);
    if (prior.length < node.period) return false;
    return node.direction === "above" ? latest.close > Math.max(...prior.map((bar) => bar.high)) : latest.close < Math.min(...prior.map((bar) => bar.low));
  }
  if (node.indicator === "macd_cross") {
    if (closes.length < 35) return false;
    const macd = ema(closes, 12).map((value, index) => value - ema(closes, 26)[index]);
    const signal = ema(macd, 9);
    const index = closes.length - 1;
    return node.direction === "bullish" ? macd[index] > signal[index] && macd[index - 1] <= signal[index - 1] : macd[index] < signal[index] && macd[index - 1] >= signal[index - 1];
  }
  if (node.indicator === "candle") {
    const bullish = latest.close > latest.open;
    const bearish = latest.close < latest.open;
    const body = Math.abs(latest.close - latest.open);
    const lowerWick = Math.min(latest.open, latest.close) - latest.low;
    const upperWick = latest.high - Math.max(latest.open, latest.close);
    if (node.pattern === "bullish") return bullish;
    if (node.pattern === "bearish") return bearish;
    if (node.pattern === "bullish_engulfing") return bullish && previous.close < previous.open && latest.close >= previous.open && latest.open <= previous.close;
    if (node.pattern === "bearish_engulfing") return bearish && previous.close > previous.open && latest.close <= previous.open && latest.open >= previous.close;
    if (node.pattern === "bullish_pinbar") return lowerWick > body * 2 && upperWick < body;
    if (node.pattern === "bearish_pinbar") return upperWick > body * 2 && lowerWick < body;
  }
  return false;
}

function strategyFromModel(result, sourcePrompt) {
  if (!result || typeof result.strategyName !== "string" || typeof result.summary !== "string") return null;
  const longEntry = validateRuleTree(result.longEntry);
  const shortEntry = validateRuleTree(result.shortEntry);
  if (!longEntry || !shortEntry) return null;
  const stopAtr = Number(result.stopAtr || 1);
  const targetR = Number(result.targetR || 2);
  if (!Number.isFinite(stopAtr) || !Number.isFinite(targetR) || stopAtr < 0.25 || stopAtr > 5 || targetR < 0.5 || targetR > 10) return null;
  return {
    id: `agent-${crypto.randomUUID()}`,
    name: result.strategyName.trim().slice(0, 48),
    type: "rules",
    enabled: true,
    custom: true,
    params: { longEntry, shortEntry, stopAtr, targetR },
    prompt: sourcePrompt,
    summary: result.summary,
  };
}

function strategyPerformance(id) {
  const results = state.outcomes.flatMap((outcome) => outcome.strategyResults || []).filter((record) => record.id === id);
  const wins = results.filter((record) => record.result === "win").length;
  const losses = results.length - wins;
  const rate = (wins + 1) / (results.length + 2);
  return { records: results.length, wins, losses, multiplier: Math.max(0.55, Math.min(1.45, 0.65 + rate * 0.7)) };
}

function getSignal(features) {
  const active = state.strategies.filter((strategy) => strategy.enabled);
  if (!active.length) return { direction: "WAIT", confidence: 50, score: 0, active, votes: [] };
  const votes = active.map((strategy) => ({ strategy, score: rawScore(strategy.type, features, strategy.params), performance: strategyPerformance(strategy.id) }));
  const weightTotal = votes.reduce((sum, vote) => sum + vote.performance.multiplier, 0);
  const score = votes.reduce((sum, vote) => sum + vote.score * vote.performance.multiplier, 0) / weightTotal;
  const direction = score > 0.18 ? "BUY BIAS" : score < -0.18 ? "SELL BIAS" : "WAIT";
  const confidence = Math.round(50 + Math.abs(score) * 40);
  return { direction, confidence, score, active, votes };
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

function render() {
  if (state.bars.length < 2) return;
  const features = calculateFeatures();
  const signal = getSignal(features);
  state.currentSignal = signal;
  const hasData = state.dataReady;
  const firstPrice = state.bars[0].close;
  const change = features.latest.close - firstPrice;
  const changePct = (change / firstPrice) * 100;
  $("#last-price").textContent = hasData ? formatPrice(features.latest.close) : "—";
  $("#price-change").textContent = hasData ? `${change >= 0 ? "+" : ""}${formatPrice(change)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)` : "IMPORT CSV";
  $("#price-change").classList.toggle("down", hasData && change < 0);
  $("#data-source").textContent = state.source;
  $("#structure-value").textContent = hasData ? (features.fast.at(-1) >= features.slow.at(-1) ? "UPTREND" : "DOWNTREND") : "—";
  $("#structure-note").textContent = hasData ? `EMA 9 ${features.fast.at(-1) >= features.slow.at(-1) ? ">" : "<"} EMA 21` : "Import candles";
  $("#rsi-value").textContent = hasData ? features.currentRsi.toFixed(1) : "—";
  $("#rsi-note").textContent = hasData ? (features.currentRsi > 70 ? "Overbought zone" : features.currentRsi < 30 ? "Oversold zone" : "Neutral momentum") : "Import candles";
  $("#atr-value").textContent = hasData ? formatPrice(features.currentAtr) : "—";
  const time = new Date(features.latest.time);
  $("#bar-time").textContent = hasData ? time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  $("#bar-date").textContent = hasData ? time.toLocaleDateString([], { month: "short", day: "numeric" }) : "Waiting for CSV";
  const signalCard = $("#signal-card");
  signalCard.className = `signal-card ${hasData && signal.score > 0.18 ? "bullish" : hasData && signal.score < -0.18 ? "bearish" : "neutral"}`;
  const planState = $("#plan-state");
  planState.textContent = !hasData ? "NEEDS MARKET DATA" : signal.direction === "WAIT" ? "NO CLEAR SETUP" : "READY TO REVIEW";
  planState.className = `plan-state ${!hasData || signal.direction === "WAIT" ? "pending" : "ready"}`;
  $("#signal-direction").textContent = !hasData ? "WAIT FOR DATA" : signal.direction;
  $("#signal-confidence").textContent = !hasData ? "—" : `${signal.votes.filter((vote) => Math.sign(vote.score) === Math.sign(signal.score) && Math.abs(vote.score) > 0.18).length} / ${signal.active.length} ALIGN`;
  $("#confidence-fill").style.width = hasData ? `${signal.confidence}%` : "0%";
  const align = signal.votes.filter((vote) => Math.sign(vote.score) === Math.sign(signal.score) && Math.abs(vote.score) > 0.18).length;
  $("#signal-summary").textContent = !hasData
    ? "Import recent XAU/USD OHLC candles. Demo data is never used to show trade levels."
    : signal.direction === "WAIT"
    ? "Active setups are mixed or weak. Wait for cleaner confluence."
    : `${align} of ${signal.active.length} active setups align. This is a rule-based bias, not a probability of profit.`;
  const stopDistance = features.currentAtr * state.stopAtr;
  const isBuy = signal.score > 0;
  const stop = isBuy ? features.latest.close - stopDistance : features.latest.close + stopDistance;
  const target = isBuy ? features.latest.close + stopDistance * state.targetR : features.latest.close - stopDistance * state.targetR;
  const showPlan = hasData && signal.direction !== "WAIT";
  $("#level-entry").textContent = showPlan ? formatPrice(features.latest.close) : "—";
  $("#level-stop").textContent = showPlan ? formatPrice(stop) : "—";
  $("#level-target").textContent = showPlan ? formatPrice(target) : "—";
  $("#level-rr").textContent = showPlan ? `1 : ${state.targetR.toFixed(1)}` : "—";
  renderStrategies(signal);
  renderJournal();
  renderAgentStrategies();
  drawChart(features);
}

function renderStrategies(signal) {
  $("#strategy-count").textContent = state.strategies.filter((strategy) => strategy.enabled).length;
  $("#strategy-list").innerHTML = state.strategies.map((strategy) => {
    const vote = signal.votes.find((item) => item.strategy.id === strategy.id);
    const performance = strategyPerformance(strategy.id);
    const score = vote?.score || 0;
    const label = score > 0.18 ? "BULLISH" : score < -0.18 ? "BEARISH" : "NEUTRAL";
    const meterWidth = `${Math.round(performance.multiplier / 1.45 * 100)}%`;
    return `<div class="strategy-row">
      <input class="strategy-toggle" type="checkbox" aria-label="Enable ${escapeHtml(strategy.name)}" data-toggle="${escapeHtml(strategy.id)}" ${strategy.enabled ? "checked" : ""} />
      <div class="strategy-name"><strong>${escapeHtml(strategy.name)}</strong><small>${performance.records ? `${performance.wins}W · ${performance.losses}L · ${performance.records} logged` : typeLabel(strategy.type)}</small></div>
      <span class="strategy-vote ${score > 0.18 ? "bullish" : score < -0.18 ? "bearish" : ""}">${strategy.enabled ? label : "PAUSED"}</span>
      <span class="weight-meter" title="Relative weight ${performance.multiplier.toFixed(2)}"><i style="width:${meterWidth}"></i></span>
      ${strategy.custom ? `<button class="strategy-remove" type="button" data-remove="${escapeHtml(strategy.id)}" aria-label="Remove ${escapeHtml(strategy.name)}">×</button>` : "<span></span>"}
    </div>`;
  }).join("");
}

function renderAgentStrategies() {
  $("#strategy-version-name").textContent = `${state.strategyName} · v${state.strategyVersion}`;
  $("#agent-strategies").innerHTML = state.strategies.filter((strategy) => strategy.enabled).map((strategy) =>
    `<span class="strategy-chip">${escapeHtml(strategy.name)}</span>`
  ).join("") || "<span class=\"no-strategies\">No active strategies</span>";
}

function scoreStrategies(strategies, features) {
  const enabled = strategies.filter((strategy) => strategy.enabled);
  if (!enabled.length) return 0;
  const votes = enabled.map((strategy) => ({
    score: rawScore(strategy.type, features, strategy.params),
    weight: strategyPerformance(strategy.id).multiplier,
  }));
  const totalWeight = votes.reduce((sum, vote) => sum + vote.weight, 0);
  return votes.reduce((sum, vote) => sum + vote.score * vote.weight, 0) / totalWeight;
}

function simulatedR(bars, index, direction, currentAtr, settings) {
  const entry = bars[index].close;
  const stopAtr = settings.stopAtr ?? state.stopAtr;
  const targetR = settings.targetR ?? state.targetR;
  const risk = currentAtr * stopAtr;
  const sign = Math.sign(direction);
  const stop = entry - sign * risk;
  const target = entry + sign * risk * targetR;
  const horizon = Math.min(12, bars.length - index - 1);
  for (let offset = 1; offset <= horizon; offset += 1) {
    const bar = bars[index + offset];
    const stopped = sign > 0 ? bar.low <= stop : bar.high >= stop;
    const targeted = sign > 0 ? bar.high >= target : bar.low <= target;
    if (stopped && targeted) return -1;
    if (stopped) return -1;
    if (targeted) return targetR;
  }
  const finalMove = (bars[index + horizon].close - entry) * sign / Math.max(risk, 0.000001);
  return Math.max(-1, Math.min(targetR, finalMove));
}

function evaluateBlend(bars, candidate = null) {
  const baseline = state.strategies.filter((strategy) => strategy.enabled);
  const combined = candidate ? [...baseline, candidate] : baseline;
  const settings = candidate?.params || { stopAtr: state.stopAtr, targetR: state.targetR };
  const firstIndex = Math.max(50, Math.floor(bars.length * 0.7));
  const outcomes = { baseline: [], combined: [] };
  for (let index = firstIndex; index < bars.length - 12; index += 4) {
    const features = calculateFeaturesForBars(bars.slice(0, index + 1));
    for (const [key, strategies] of [["baseline", baseline], ["combined", combined]]) {
      const score = scoreStrategies(strategies, features);
      if (Math.abs(score) <= 0.18) continue;
      outcomes[key].push(simulatedR(bars, index, score, features.currentAtr, settings));
    }
  }
  const summarize = (values) => ({
    count: values.length,
    avgR: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    wins: values.length ? values.filter((value) => value > 0).length / values.length : 0,
  });
  return { baseline: summarize(outcomes.baseline), combined: summarize(outcomes.combined) };
}

function displayBacktest(result) {
  $("#agent-comparison").hidden = false;
  $("#baseline-result").textContent = `${result.baseline.avgR.toFixed(2)}R avg · ${Math.round(result.baseline.wins * 100)}% wins`;
  $("#baseline-count").textContent = `${result.baseline.count} held-out signals`;
  $("#candidate-result").textContent = `${result.combined.avgR.toFixed(2)}R avg · ${Math.round(result.combined.wins * 100)}% wins`;
  $("#candidate-count").textContent = `${result.combined.count} held-out signals`;
}

$("#test-strategy").addEventListener("click", async () => {
  const prompt = $("#strategy-prompt").value.trim();
  const button = $("#test-strategy");
  $("#agent-comparison").hidden = true;
  if (!getApiKey()) {
    $("#agent-test-state").textContent = "CONNECT GEMINI";
    $("#agent-message").textContent = "Add your Google AI Studio API key under Connect AI model. The key stays in this tab and is sent only to Google.";
    $(".ai-connection").open = true;
    return;
  }
  if (!state.dataReady) {
    $("#agent-test-state").textContent = "IMPORT PRICE DATA";
    $("#agent-message").textContent = "Add historical XAU/USD candles first so extracted rules can be tested before they change the blend.";
    return;
  }
  if (getAnalysisBars().length < 250) {
    $("#agent-test-state").textContent = "MORE HISTORY NEEDED";
    $("#agent-message").textContent = "Import at least 250 candles. The last 30% is held out from strategy evaluation.";
    return;
  }
  if (!prompt && !strategyVideoFile) {
    $("#agent-test-state").textContent = "ADD RULES";
    $("#agent-message").textContent = "Describe a strategy or add a tutorial video.";
    return;
  }
  button.disabled = true;
  try {
    $("#agent-test-state").textContent = strategyVideoFile ? "UPLOADING TUTORIAL" : "READING STRATEGY";
    const parts = [{ text: [
      "Analyze the user's trading strategy prompt and attached tutorial media. Extract the actual entry rules; do not invent missing rules.",
      "Return JSON only with: strategyName, summary, backtestable, limitations, longEntry, shortEntry, stopAtr, targetR.",
      "Represent entries as a tree using {all:[...]}, {any:[...]}, or leaves.",
      "Allowed leaves: {indicator:'rsi',period:14,operator:'lt|lte|gt|gte',value:30}; {indicator:'ema_cross',fast:9,slow:21,direction:'bullish|bearish'}; {indicator:'price_ema',period:50,direction:'above|below'}; {indicator:'breakout',period:20,direction:'above|below'}; {indicator:'macd_cross',direction:'bullish|bearish'}; {indicator:'candle',pattern:'bullish|bearish|bullish_engulfing|bearish_engulfing|bullish_pinbar|bearish_pinbar'}.",
      "Use nested any/all to express complex strategies. The app backtests these rules on the user's candles. If the taught rules require unavailable data or cannot be represented faithfully, set backtestable false and explain why in limitations; never silently replace a rule with a different one.",
      "Use stopAtr and targetR from the taught strategy when present; otherwise choose conservative defaults of 1 and 2. Numeric values must be finite.",
      `User prompt/transcript: ${prompt || "No extra prompt; extract rules from the attached tutorial."}`,
    ].join("\n") }];
    if (strategyVideoFile) {
      const videoPart = await uploadVideoToGemini(strategyVideoFile);
      parts.push(videoPart);
      $("#agent-test-state").textContent = "STUDYING TUTORIAL";
    }
    const extracted = await geminiGenerate(parts);
    if (extracted.backtestable === false) {
      $("#agent-test-state").textContent = "RULES NEED MORE DATA";
      $("#agent-message").textContent = extracted.limitations || extracted.summary || "The strategy needs information that is not present in the uploaded candles.";
      return;
    }
    const candidate = strategyFromModel(extracted, prompt);
    if (!candidate) throw new Error("The model could not express this strategy in backtestable entry rules. Add more detail and retry.");
    $("#agent-test-state").textContent = "BACKTESTING RULES";
    const result = evaluateBlend(getAnalysisBars(), candidate);
    displayBacktest(result);
    if (result.baseline.count < 8 || result.combined.count < 8) {
      $("#agent-test-state").textContent = "TOO FEW SIGNALS";
      $("#agent-message").textContent = `${candidate.summary} Test history produced fewer than 8 held-out signals; nothing was added.`;
      return;
    }
    const improves = result.combined.avgR >= result.baseline.avgR + 0.05
      && result.combined.wins >= result.baseline.wins - 0.05
      && result.combined.count >= result.baseline.count * 0.7;
    if (!improves) {
      $("#agent-test-state").textContent = "NOT PROMOTED";
      $("#agent-message").textContent = `${candidate.summary} The combined rules did not pass the held-out improvement check, so your current blend stays unchanged.`;
      return;
    }
    state.strategies.push(candidate);
    state.strategyVersion += 1;
    state.strategyName = `${candidate.name} Fusion`;
    state.stopAtr = candidate.params.stopAtr;
    state.targetR = candidate.params.targetR;
    saveStorage();
    render();
    displayBacktest(result);
    $("#agent-test-state").textContent = "NEW VERSION PROMOTED";
    $("#agent-message").textContent = `${candidate.summary} Promoted as ${state.strategyName} v${state.strategyVersion}; historical gains are not a guarantee of future performance.`;
  } catch (error) {
    $("#agent-test-state").textContent = "ANALYSIS FAILED";
    $("#agent-message").textContent = error.message || "Could not analyze this media. Check the key, file format, and network, then retry.";
  } finally {
    button.disabled = false;
  }
});

$("#strategy-video-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  strategyVideoFile = file;
  $("#strategy-video").src = videoUrl;
  $("#strategy-video").hidden = false;
  $("#video-file-name").textContent = file.name;
  event.target.value = "";
});

$("#strategy-transcript-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = (await file.text())
      .replace(/^\uFEFF?WEBVTT.*$/gim, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->.*$/gm, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    $("#strategy-prompt").value = `${$("#strategy-prompt").value.trim()}\n${text}`.trim().slice(0, 5000);
    $("#agent-test-state").textContent = "CAPTIONS LOADED";
  } catch {
    showToast("The transcript file could not be read.");
  }
  event.target.value = "";
});

$("#stop-atr").addEventListener("change", (event) => {
  state.stopAtr = Number(event.target.value);
  render();
});
$("#target-r").addEventListener("change", (event) => {
  state.targetR = Number(event.target.value);
  render();
});

function renderJournal() {
  const count = state.outcomes.length;
  $("#journal-count").textContent = `${count} LOGGED`;
  if (!count) {
    $("#learning-summary").textContent = "No outcomes yet. Log a result to start calibrating the blend.";
    $("#journal-list").innerHTML = "";
    return;
  }
  const wins = state.outcomes.filter((item) => item.result === "win").length;
  $("#learning-summary").textContent = `${wins} favorable of ${count} logged. Smoothed weights update gradually; a small sample can be noisy.`;
  $("#journal-list").innerHTML = state.outcomes.slice(-5).reverse().map((item) => {
    const date = new Date(item.date).toLocaleDateString([], { month: "short", day: "numeric" });
    const names = item.strategyNames.map(escapeHtml).join(", ");
    return `<div class="journal-entry"><div><strong>${escapeHtml(item.direction)} · ${formatPrice(item.price)}</strong><small>${date}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</small><small>${names || "No active setups"}</small></div><span class="${item.result}">${item.result === "win" ? "FAVORABLE" : "UNFAVORABLE"}</span></div>`;
  }).join("");
}

function typeLabel(type) {
  return { trend: "EMA trend following", momentum: "Range expansion", mean: "RSI mean reversion", liquidity: "Wick sweep rejection", rules: "AI-extracted rules" }[type] || "Custom strategy";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function drawChart(features) {
  const bounds = chart.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = window.devicePixelRatio || 1;
  chart.width = Math.round(bounds.width * ratio);
  chart.height = Math.round(bounds.height * ratio);
  chartContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = bounds.width;
  const height = bounds.height;
  chartContext.clearRect(0, 0, width, height);
  const bars = getAnalysisBars().slice(-80);
  const closes = bars.map((bar) => bar.close);
  const averages = ema(closes, Math.min(21, closes.length));
  const maxPrice = Math.max(...bars.map((bar) => bar.high));
  const minPrice = Math.min(...bars.map((bar) => bar.low));
  const pad = { top: 12, right: 61, bottom: 24, left: 7 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const priceY = (price) => pad.top + (maxPrice - price) / Math.max(maxPrice - minPrice, 0.01) * plotHeight;
  chartContext.font = "10px 'DM Mono', monospace";
  chartContext.textBaseline = "middle";
  for (let line = 0; line < 5; line += 1) {
    const y = pad.top + plotHeight * line / 4;
    const price = maxPrice - (maxPrice - minPrice) * line / 4;
    chartContext.strokeStyle = "#2b352f";
    chartContext.beginPath(); chartContext.moveTo(pad.left, y); chartContext.lineTo(width - pad.right + 4, y); chartContext.stroke();
    chartContext.fillStyle = "#89948c";
    chartContext.fillText(price.toFixed(2), width - pad.right + 10, y);
  }
  const gap = plotWidth / bars.length;
  const candleWidth = Math.max(2, Math.min(8, gap * 0.58));
  bars.forEach((bar, index) => {
    const x = pad.left + gap * index + gap / 2;
    const up = bar.close >= bar.open;
    chartContext.strokeStyle = up ? "#9ccc75" : "#d77b68";
    chartContext.fillStyle = up ? "#9ccc75" : "#d77b68";
    chartContext.beginPath(); chartContext.moveTo(x, priceY(bar.high)); chartContext.lineTo(x, priceY(bar.low)); chartContext.stroke();
    const top = priceY(Math.max(bar.open, bar.close));
    const bottom = priceY(Math.min(bar.open, bar.close));
    chartContext.fillRect(x - candleWidth / 2, top, candleWidth, Math.max(bottom - top, 1));
  });
  chartContext.strokeStyle = "#d7b76b";
  chartContext.lineWidth = 1.4;
  chartContext.beginPath();
  averages.forEach((average, index) => {
    const x = pad.left + gap * index + gap / 2;
    index === 0 ? chartContext.moveTo(x, priceY(average)) : chartContext.lineTo(x, priceY(average));
  });
  chartContext.stroke();
  chartContext.lineWidth = 1;
  const currentY = priceY(features.latest.close);
  chartContext.setLineDash([3, 3]); chartContext.strokeStyle = "#a7d86d77";
  chartContext.beginPath(); chartContext.moveTo(pad.left, currentY); chartContext.lineTo(width - pad.right + 4, currentY); chartContext.stroke(); chartContext.setLineDash([]);
  chartContext.fillStyle = "#a7d86d"; chartContext.fillRect(width - pad.right + 6, currentY - 9, 53, 18);
  chartContext.fillStyle = "#142015"; chartContext.fillText(features.latest.close.toFixed(2), width - pad.right + 9, currentY);
  chartContext.fillStyle = "#859087";
  const labels = [bars[0], bars[Math.floor(bars.length / 3)], bars[Math.floor(bars.length * 2 / 3)], bars.at(-1)];
  labels.forEach((bar, index) => {
    const x = pad.left + plotWidth * index / 3;
    chartContext.fillText(new Date(bar.time).toLocaleDateString([], { month: "short", day: "numeric" }), x, height - 10);
  });
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 3) throw new Error("CSV needs a header and at least two OHLC rows.");
  const headers = lines[0].split(",").map((value) => value.trim().toLowerCase().replace(/["']/g, ""));
  const findColumn = (names) => headers.findIndex((header) => names.includes(header));
  const columns = {
    time: findColumn(["time", "date", "datetime", "timestamp"]),
    open: findColumn(["open", "o"]), high: findColumn(["high", "h"]),
    low: findColumn(["low", "l"]), close: findColumn(["close", "c"]),
  };
  if ([columns.open, columns.high, columns.low, columns.close].some((column) => column < 0)) {
    throw new Error("Expected columns named open, high, low, close, and optionally time/date.");
  }
  const bars = lines.slice(1).map((line, index) => {
    const cells = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
    const price = (key) => Number(cells[columns[key]]);
    const bar = { open: price("open"), high: price("high"), low: price("low"), close: price("close"), volume: 0 };
    const rawTime = columns.time >= 0 ? cells[columns.time] : index;
    const parsedTime = Number(rawTime);
    bar.time = Number.isFinite(parsedTime) && String(rawTime).trim() !== "" ? (parsedTime > 1e12 ? parsedTime : parsedTime > 1e9 ? parsedTime * 1000 : Date.now() - (lines.length - index) * 3600000) : Date.parse(rawTime);
    if (Object.values(bar).some((value) => !Number.isFinite(value)) || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) return null;
    return bar;
  }).filter(Boolean);
  if (bars.length < 2) throw new Error("Could not read two valid OHLC rows from this CSV.");
  return bars.slice(-500);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function drawScreenshot() {
  if (!screenshotState.image) return;
  screenshotContext.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
  screenshotContext.drawImage(screenshotState.image, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
  if (!screenshotState.crop) return;
  const { x, y, width, height } = screenshotState.crop;
  screenshotContext.fillStyle = "rgba(4, 8, 5, 0.58)";
  screenshotContext.fillRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
  screenshotContext.save();
  screenshotContext.beginPath();
  screenshotContext.rect(x, y, width, height);
  screenshotContext.clip();
  screenshotContext.drawImage(screenshotState.image, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
  screenshotContext.restore();
  screenshotContext.strokeStyle = "#b7e47f";
  screenshotContext.lineWidth = Math.max(2, screenshotCanvas.width / 700);
  screenshotContext.strokeRect(x, y, width, height);
}

function screenshotPoint(event) {
  const bounds = screenshotCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(screenshotCanvas.width, (event.clientX - bounds.left) * screenshotCanvas.width / bounds.width)),
    y: Math.max(0, Math.min(screenshotCanvas.height, (event.clientY - bounds.top) * screenshotCanvas.height / bounds.height)),
  };
}

function updateScreenshotCrop(point) {
  if (!screenshotState.start) return;
  const { x, y } = screenshotState.start;
  screenshotState.crop = { x: Math.min(x, point.x), y: Math.min(y, point.y), width: Math.abs(point.x - x), height: Math.abs(point.y - y) };
  drawScreenshot();
}

function loadScreenshot(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Choose an image file or take a chart photo.");
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (screenshotState.url) URL.revokeObjectURL(screenshotState.url);
    const scale = Math.min(1, 1400 / image.width, 1000 / image.height);
    screenshotState.image = image;
    screenshotState.url = url;
    screenshotState.crop = null;
    screenshotState.start = null;
    screenshotCanvas.width = Math.round(image.width * scale);
    screenshotCanvas.height = Math.round(image.height * scale);
    $("#screenshot-filename").textContent = file.name;
    $("#screenshot-empty").hidden = true;
    $("#screenshot-canvas-wrap").hidden = false;
    $("#screenshot-panel").hidden = false;
    $("#screenshot-idle").hidden = false;
    $("#screenshot-result").hidden = true;
    $("#analyze-screenshot").disabled = false;
    $("#screenshot-selection-label").textContent = "Ready to scan the full screenshot. Drag to select a crop if preferred.";
    drawScreenshot();
    $("#screenshot-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast("That image could not be opened.");
  };
  image.src = url;
}

async function analyzeScreenshot() {
  if (!screenshotState.image) return;
  const crop = screenshotState.crop || { x: 0, y: 0, width: screenshotCanvas.width, height: screenshotCanvas.height };
  if (crop.width < 40 || crop.height < 30) return;
  if (!getApiKey()) {
    $("#agent-test-state").textContent = "CONNECT GEMINI";
    $("#agent-message").textContent = "Add your Google AI Studio API key under Connect AI model to analyze the chart image.";
    $(".ai-connection").open = true;
    return;
  }
  const button = $("#analyze-screenshot");
  button.disabled = true;
  $("#screenshot-idle").hidden = false;
  $("#screenshot-result").hidden = true;
  $("#screenshot-selection-label").textContent = "Sending selected chart crop to Gemini…";
  try {
    const source = document.createElement("canvas");
    const maxSide = 2048;
    const scale = Math.min(1, maxSide / crop.width, maxSide / crop.height);
    source.width = Math.round(crop.width * scale);
    source.height = Math.round(crop.height * scale);
    source.getContext("2d").drawImage(screenshotState.image, crop.x, crop.y, crop.width, crop.height, 0, 0, source.width, source.height);
    const blob = await new Promise((resolve) => source.toBlob(resolve, "image/jpeg", 0.88));
    if (!blob) throw new Error("Could not prepare this image crop.");
    const imageData = await blobToBase64(blob);
    const result = await geminiGenerate([
      { text: "Analyze this XAU/USD trading-chart screenshot or crop. Locate the chart plot and inspect any visible price labels or marked levels. Extract only information visibly supported by the image. Never invent prices or levels; use null if unreadable or absent. Return JSON: {direction:'long|short|wait|unclear', confidence:'low|medium|high', visualSummary:string, currentPrice:number|null, entry:number|null, stopLoss:number|null, takeProfit:number|null, caveats:string[]}. Distinguish an observed written level from your own suggested level. This is educational analysis, not a guarantee." },
      { inline_data: { mime_type: "image/jpeg", data: imageData } },
    ]);
    $("#screenshot-idle").hidden = true;
    $("#screenshot-result").hidden = false;
    $("#screenshot-trend").textContent = `${String(result.direction || "unclear").toUpperCase()} · ${String(result.confidence || "low").toUpperCase()} CONFIDENCE`;
    $("#screenshot-trend").style.color = result.direction === "long" ? "var(--green)" : result.direction === "short" ? "var(--red)" : "var(--gold)";
    $("#screenshot-bars").textContent = result.currentPrice == null ? "Not legible" : formatPrice(Number(result.currentPrice));
    const levelText = [result.entry, result.stopLoss, result.takeProfit].map((value) => value == null ? "—" : formatPrice(Number(value))).join(" / ");
    $("#screenshot-colors").textContent = levelText;
    const caveats = Array.isArray(result.caveats) ? result.caveats.join(" ") : String(result.caveats || "");
    const priceNote = result.currentPrice == null ? "" : ` Last visible price: ${formatPrice(Number(result.currentPrice))}.`;
    $("#screenshot-summary").textContent = `${result.visualSummary || "No clear chart read."}${priceNote}${caveats ? ` ${caveats}` : ""}`;
    $("#screenshot-selection-label").textContent = "AI read complete. Verify all levels against your broker chart.";
  } catch (error) {
    $("#screenshot-selection-label").textContent = "Analysis failed. Check Gemini connection and retry.";
    $("#agent-message").textContent = error.message;
  } finally {
    button.disabled = !screenshotState.image;
  }
}

$("#screenshot-file").addEventListener("change", (event) => {
  loadScreenshot(event.target.files[0]);
  event.target.value = "";
});

const screenshotStage = $("#screenshot-stage");
for (const eventName of ["dragenter", "dragover"]) {
  screenshotStage.addEventListener(eventName, (event) => {
    event.preventDefault();
    screenshotStage.classList.add("dragging");
  });
}
screenshotStage.addEventListener("dragleave", () => screenshotStage.classList.remove("dragging"));
screenshotStage.addEventListener("drop", (event) => {
  event.preventDefault();
  screenshotStage.classList.remove("dragging");
  loadScreenshot(event.dataTransfer.files[0]);
});

screenshotCanvas.addEventListener("pointerdown", (event) => {
  if (!screenshotState.image) return;
  event.preventDefault();
  screenshotState.start = screenshotPoint(event);
  screenshotState.crop = { x: screenshotState.start.x, y: screenshotState.start.y, width: 0, height: 0 };
  screenshotCanvas.setPointerCapture(event.pointerId);
  $("#screenshot-result").hidden = true;
  $("#screenshot-idle").hidden = false;
  $("#analyze-screenshot").disabled = true;
  updateScreenshotCrop(screenshotState.start);
});
screenshotCanvas.addEventListener("pointermove", (event) => {
  if (screenshotState.start) updateScreenshotCrop(screenshotPoint(event));
});
screenshotCanvas.addEventListener("pointerup", (event) => {
  if (!screenshotState.start) return;
  updateScreenshotCrop(screenshotPoint(event));
  screenshotState.start = null;
  const crop = screenshotState.crop;
  const valid = crop && crop.width >= 40 && crop.height >= 30;
  if (!valid) {
    screenshotState.crop = null;
    drawScreenshot();
  }
  $("#analyze-screenshot").disabled = false;
  $("#screenshot-selection-label").textContent = valid
    ? `Selected area · ${Math.round(crop.width)} × ${Math.round(crop.height)} px`
    : "Small selection cleared. The AI will scan the full screenshot.";
});

$("#analyze-screenshot").addEventListener("click", analyzeScreenshot);
$("#screenshot-clear").addEventListener("click", () => {
  if (screenshotState.url) URL.revokeObjectURL(screenshotState.url);
  screenshotState.image = null;
  screenshotState.url = null;
  screenshotState.crop = null;
  screenshotState.start = null;
  $("#screenshot-filename").textContent = "";
  $("#screenshot-canvas-wrap").hidden = true;
  $("#screenshot-empty").hidden = false;
  $("#screenshot-idle").hidden = false;
  $("#screenshot-result").hidden = true;
  $("#analyze-screenshot").disabled = true;
  $("#screenshot-selection-label").textContent = "Select the candle plot to enable analysis.";
});

$("#csv-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    state.bars = parseCsv(await file.text());
    state.dataReady = true;
    state.source = `LOCAL CSV · ${file.name.toUpperCase()}`;
    $("#chart-label").textContent = "IMPORTED OHLC DATA";
    $("#chart-period").textContent = `LAST ${Math.min(state.bars.length, 80)} BARS`;
    render();
    showToast(`${state.bars.length} local candles loaded.`);
  } catch (error) {
    showToast(error.message);
  }
  event.target.value = "";
});

$(".segmented").addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeframe]");
  if (!button) return;
  state.timeframe = button.dataset.timeframe;
  document.querySelectorAll("[data-timeframe]").forEach((item) => item.classList.toggle("selected", item === button));
  $("#chart-period").textContent = `${state.timeframe} · LAST ${Math.min(getAnalysisBars().length, 80)} BARS`;
  render();
});

$("#strategy-list").addEventListener("change", (event) => {
  const id = event.target.dataset.toggle;
  if (!id) return;
  const strategy = state.strategies.find((item) => item.id === id);
  strategy.enabled = event.target.checked;
  saveStorage();
  render();
});

$("#strategy-list").addEventListener("click", (event) => {
  const id = event.target.dataset.remove;
  if (!id) return;
  state.strategies = state.strategies.filter((item) => item.id !== id);
  saveStorage();
  render();
});

const strategyDialog = $("#strategy-dialog");
$("#add-strategy").addEventListener("click", () => strategyDialog.showModal());
document.querySelectorAll(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#strategy-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name")).trim();
  if (!name) return;
  state.strategies.push({ id: `custom-${crypto.randomUUID()}`, name, type: String(form.get("type")), enabled: true, custom: true });
  saveStorage();
  event.currentTarget.reset();
  strategyDialog.close();
  render();
  showToast("Strategy added to the composite blend.");
});

window.addEventListener("resize", () => drawChart(calculateFeatures()));
readStorage();
state.bars = makeSampleBars();
render();