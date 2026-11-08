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