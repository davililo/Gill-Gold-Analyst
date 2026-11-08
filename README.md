# Gill Gold Analyst

Offline-first personal XAU/USD strategy lab. Images, videos, prompts, and price history are processed locally; there is no backend or live market feed.

## Run locally

```sh
python3 -m http.server 4173
```

Open http://localhost:4173. No install or build step is required.

## Chart image

Use **Choose image / camera** to select a chart screenshot or take a photo on a supported device, then select the candle plot and analyze it. The local pixel scan estimates visible candle groups and broad visual direction; it does not read prices, indicators, or trade levels.

## Strategy lab

Describe a strategy in the prompt, add a tutorial video for local preview, and optionally import captions/transcript (`.srt`, `.vtt`, or `.txt`). The offline app cannot transcribe or understand video audio. It recognizes a limited set of EMA trend, RSI mean-reversion, range-breakout, and liquidity-sweep rules.

Import at least 250 historical OHLC candles (`open`, `high`, `low`, `close`, and optionally `time`, `date`, `datetime`, or `timestamp`; oldest first) so it can backtest new rules. Candidates are blended with enabled rules and tested on the last 30% of the data. A candidate is promoted only with at least 8 held-out signals, average R improvement of at least 0.05, win rate no more than 5 points lower, and at least 70% of the prior signal count. Each promoted blend gets a saved local name and version.

This is a rule-based parser and historical filter, not a general-purpose AI model or autonomous machine-learning system. Repeatedly testing rules against the same history can overfit; a promoted version is not guaranteed to perform better live.