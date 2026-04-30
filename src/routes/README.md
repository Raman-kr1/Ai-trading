# 📁 Routes (`/src/routes`)

Express route definitions. Maps HTTP methods/paths to controller handlers.

## Files

| File | Endpoints |
|------|-----------|
| `trading.routes.js` | `/api/trading/*` — Market data, indicators, trade execution, watchlist, queue |
| `dashboard.routes.js` | `/dashboard/*` — Web UI and analytics API |

## API Endpoints

### Trading API (`/api/trading`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/market-data` | Fetch candle data for a symbol |
| GET | `/indicators` | Compute technical indicators |
| POST | `/trade` | Trigger a trading cycle |
| POST | `/trade/close` | Close an open trade |
| POST | `/ai-analysis` | Get AI analysis without executing |
| POST | `/watchlist` | Update recurring trading watchlist |
| GET | `/queue/status` | Get BullMQ queue stats |

### Dashboard API (`/dashboard`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve dashboard HTML |
| GET | `/api/stats` | Portfolio statistics |
| GET | `/api/daily-pnl` | Daily PnL breakdown |
| GET | `/api/trades` | Recent trades |
| GET | `/api/decisions` | Recent AI decisions |
| GET | `/api/ai-accuracy` | AI accuracy metrics |
