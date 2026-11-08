# Gill Gold Analyst

Personal XAU/USD strategy lab. The static app has no backend or live market feed; Gemini performs AI analysis when you connect your own API key.

## Run locally

```sh
python3 -m http.server 4173
```

Open http://localhost:4173. No install or build step is required.

## Connect Gemini

Create a [Google AI Studio API key](https://aistudio.google.com/apikey) and enter it under **Connect AI model**. It is held in the current browser tab's session storage and is not included in the repository. Requests go directly to Google Gemini, including the selected chart crop, uploaded tutorial video, or prompt. Review Google's terms and apply API-key restrictions and quotas. Do not share the key or use this direct-browser setup for a multi-user service.

## Chart image

Choose a screenshot or take a phone photo, crop the chart area, and ask Gemini for a visual read and visible entry/stop/target levels. Verify every extracted price manually; image-based values can be wrong.

## Strategy agent

Upload a tutorial video, add captions/transcript if available, or enter any strategy prompt. Gemini extracts entry rules into a validated indicator-rule format, then the app tests the combination against the final 30% of at least 250 imported historical OHLC candles. Videos are uploaded directly to Gemini for processing and may be subject to its supported formats and limits.

A candidate is promoted only with at least 8 held-out signals, average R improvement of at least 0.05, win rate no more than 5 points lower, and at least 70% of the prior signal count. This guard can still overfit repeated experiments and does not guarantee future improvement. Strategies that require data missing from the imported candles cannot be backtested faithfully.