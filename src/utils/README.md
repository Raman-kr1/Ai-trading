# 📁 Utilities (`/src/utils`)

Shared helper functions and logging infrastructure.

## Files

| File | Purpose |
|------|---------|
| `logger.js` | Winston-based structured logging with file rotation |
| `helpers.js` | Trade ID generation, HMAC signing, candle normalization, retry logic |

## Logger

Outputs to:
- `logs/combined.log` — All log levels
- `logs/error.log` — Error-level only
- `logs/trades.log` — Trade-specific activity
- Console (dev mode only, with colors)

## Helper Functions

| Function | Purpose |
|----------|---------|
| `generateTradeId()` | Unique trade identifier: `TRD-{timestamp}-{random}` |
| `normalizeCandle()` | Converts Binance/Zerodha candle formats to common OHLCV |
| `createHmacSignature()` | HMAC-SHA256 for exchange API authentication |
| `retryWithBackoff()` | Generic retry with exponential delay |
| `validateFields()` | Object field presence validation |
| `roundTo()` | Decimal precision rounding |
| `percentChange()` | Calculate % change between values |
