# 📁 Services (`/src/services`)

Core business logic modules. Each service is independently testable and follows a single-responsibility pattern.

## Files

| File | Purpose |
|------|---------|
| `marketData.service.js` | Fetches real-time data from Binance (REST + WebSocket) and Zerodha Kite |
| `indicator.service.js` | Computes RSI, MACD, EMA(20/50), VWAP, SMA from OHLCV candles |
| `ai.service.js` | Claude API integration with strict JSON prompt engineering |
| `risk.service.js` | Hard-rule risk engine that overrides AI decisions |
| `execution.service.js` | Places orders on exchanges or simulates paper trades |
| `analytics.service.js` | PnL tracking, win rate, and AI accuracy analytics |

## Data Flow

```
marketData → indicator → ai → risk → execution
                                        ↓
                                    analytics
```

## Key Design Principles

1. **All services are stateless** — state lives in Redis (cache) or MongoDB (persistence)
2. **Error boundaries** — each service handles its own errors and returns safe defaults
3. **Normalization** — all market data is converted to a common candle format before processing
4. **Audit trail** — every AI decision is logged, regardless of whether a trade is executed
