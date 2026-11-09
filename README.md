# Gill MT5 Chart Reader

Single-purpose, local XAU/USD screenshot reader. The browser scans colored candle pixels and applies the saved strategy rules in `skills/`. There is no Gemini integration, API key, external analysis request, or trade execution.

## Run locally

```sh
python3 -m http.server 4173
```

Open http://localhost:4173. No install or build step is required.

## Local knowledge

The saved rulebook is `skills/gold-ema-pullback.json`. It combines the original EMA20/EMA50 pullback with valid swing structure, supply/demand zones, swing-based stops, and the 2.5R minimum-reward filter. The composite only reports LONG/SHORT when both components agree. Add future strategies to this file and the local interpreter.

## Timeframe sessions

Each session has screenshot slots for MN1, W1, D1, H4, H1, M15, M5, and M1. Replacing a screenshot updates only that timeframe; higher-timeframe images remain in the current session. **New session** clears all slots. Each slot reports detected candle groups; fewer than 12 returns WAIT.

Use **Interpret setup on** to choose a timeframe, or leave **Auto suggestion** selected. Auto prefers the slowest uploaded entry timeframe (M15, then M5, then M1) whose local setup agrees with the weighted higher-timeframe EMA/structure bias. Conflicting or missing context returns WAIT.

## First strategy

The combined strategy returns a candidate only when detected trend, valid structure, zone retest, candle confirmation, stop, and reward/risk rules agree. Otherwise it returns WAIT. On WAIT, the image can still show dashed, conditional entry/SL/TP scenarios based on detected swing areas; these are not active trade signals. Its research references are in the JSON file.

The reader does not OCR price-axis labels or compute dollar-denominated entry/stop/target values. It reports relative candle-based locations only; verify and calculate exact levels in MT5. The rule is a starting hypothesis, not a proven profitable system.