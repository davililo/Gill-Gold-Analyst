# Gill MT5 Chart Reader

Single-purpose, local XAU/USD screenshot reader. The browser scans colored candle pixels and applies the saved strategy rules in `skills/`. There is no Gemini integration, API key, external analysis request, or trade execution.

## Run locally

```sh
python3 -m http.server 4173
```

Open http://localhost:4173. No install or build step is required.

## Local knowledge

The first saved rule is `skills/gold-ema-pullback.json`. The page loads this file and uses its EMA20/EMA50 trend filter, pullback, candle confirmation, ATR stop-risk limit, and 2R target rule to interpret uploaded chart screenshots. Add future knowledge as versioned rule files and connect them to the local interpreter.

## First strategy

Gold EMA Pullback returns a candidate only when the local pixel scan detects enough colored candles and the trend, pullback, confirmation, and stop rules pass. Otherwise it returns WAIT. Its research basis and references are in the JSON file.

The reader does not OCR price-axis labels or compute dollar-denominated entry/stop/target values. It reports relative candle-based locations only; verify and calculate exact levels in MT5. The rule is a starting hypothesis, not a proven profitable system.