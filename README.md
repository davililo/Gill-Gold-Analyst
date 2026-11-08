# Gill MT5 Chart Reader

Single-purpose XAU/USD chart image reader. Select an MT5 screenshot or take a photo; analysis starts automatically. The AI scans the whole image and reports visible direction, price, entry, stop-loss, and take-profit when legible.

## Run locally

```sh
python3 -m http.server 4173
```

Open http://localhost:4173. No install or build step is required.

## Connect AI

Create a [Google AI Studio API key](https://aistudio.google.com/apikey) and enter it under **Connect AI**. It is held in this browser tab's session storage, not in the repository. The uploaded image is sent directly to Google Gemini. Review Google's terms and restrict the key; do not share it.

The app does not crop manually, train strategies, or place trades. AI-extracted values may be incorrect; verify them against your broker chart before use. Image processing and size limits depend on the browser and Google Gemini.

## First strategy: Gold EMA Pullback

Use the EMA 20/50 relationship for trend context; enter only after a pullback and a confirming candle break in the trend direction. Place the stop beyond the pullback swing, reject risk greater than 1.5 ATR(14), and require at least 2R to the next visible swing target. If the necessary overlays or levels cannot be read from the screenshot, the interpretation is WAIT.

This is a proposed starting rule, not a strategy proven profitable on XAU/USD. ChartSchool explains that moving averages are lagging trend-following indicators and that ATR measures volatility rather than direction: [Moving Averages](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential), [Average True Range](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-true-range-atr).