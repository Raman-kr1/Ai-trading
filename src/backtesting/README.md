# 📁 Backtesting (`/src/backtesting`)

Historical simulation engine for strategy validation.

## Files

| File | Purpose |
|------|---------|
| `backtest.service.js` | Replays historical candles through the full pipeline and generates performance reports |

## Usage

```bash
# Default: BTCUSDT on Binance, 500 candles, $10k capital
npm run backtest

# Custom parameters
node src/backtesting/backtest.service.js ETHUSDT binance 5m 50000 1000
```

## Report Metrics

- Total PnL and return percentage
- Win rate and profit factor
- Maximum drawdown
- Average win/loss size
- Last 10 trade details

## How It Works

1. Fetches N historical candles
2. Slides a 50-candle window across the data
3. For each position: computes indicators → gets AI decision → validates risk
4. Simulates trade outcome using actual future candles
5. Tracks cumulative capital and drawdown
