# ⚡ AI Trading Automation System

Production-ready AI trading automation system using Node.js, integrating **Binance** (crypto), **Zerodha Kite** (Indian stocks), and **Claude AI** (Anthropic) as the decision engine.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Express API Server                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  Trading  │  │Dashboard │  │  Health   │  │    Rate    │  │
│  │  Routes   │  │  Routes  │  │  Check    │  │  Limiter   │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └────────────┘  │
│       │              │                                       │
│  ┌────▼─────┐  ┌────▼──────┐                                │
│  │ Trading  │  │Dashboard  │                                 │
│  │Controller│  │Controller │                                 │
│  └────┬─────┘  └────┬──────┘                                │
└───────┼──────────────┼──────────────────────────────────────┘
        │              │
┌───────▼──────────────▼──────────────────────────────────────┐
│                    Service Layer                             │
│  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌────────────┐  │
│  │  Market   │  │Indicator │  │   AI    │  │   Risk     │  │
│  │  Data     │→ │ Engine   │→ │ Engine  │→ │  Engine    │  │
│  │ Service   │  │          │  │(Claude) │  │(Hard Rules)│  │
│  └───────────┘  └──────────┘  └─────────┘  └─────┬──────┘  │
│                                                    │         │
│  ┌───────────┐  ┌──────────┐               ┌─────▼──────┐  │
│  │ Analytics │  │Backtest  │               │ Execution  │  │
│  │ Service   │  │ Service  │               │  Service   │  │
│  └───────────┘  └──────────┘               └────────────┘  │
└──────────────────────────────────────────────────────────────┘
        │                                          │
┌───────▼──────────────────────────────────────────▼──────────┐
│                  Infrastructure                              │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  MongoDB  │  │  Redis   │  │  BullMQ  │  │  WebSocket │ │
│  │ (Trades,  │  │ (Cache)  │  │ (Queue)  │  │ (Binance)  │ │
│  │Decisions) │  │          │  │          │  │            │ │
│  └───────────┘  └──────────┘  └──────────┘  └────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
/ai-trading-system
├── package.json
├── .env.example            # Environment configuration template
├── .gitignore
├── README.md               # ← You are here
├── ARCHITECTURE.md          # Detailed architecture documentation
├── TIMELINE.md              # Development timeline and milestones
│
├── /src
│   ├── app.js              # Express app setup (middleware, routes)
│   ├── server.js           # Entry point (DB init, server start)
│   │
│   ├── /config
│   │   ├── index.js        # Centralized config with env validation
│   │   ├── database.js     # MongoDB connection manager
│   │   ├── redis.js        # Redis client + cache helpers
│   │   └── README.md
│   │
│   ├── /services
│   │   ├── marketData.service.js   # Binance + Zerodha data fetching
│   │   ├── indicator.service.js    # RSI, MACD, EMA, VWAP
│   │   ├── ai.service.js          # Claude API integration
│   │   ├── risk.service.js        # Hard-rule risk engine
│   │   ├── execution.service.js   # Order placement + paper trading
│   │   ├── analytics.service.js   # PnL, win rate, AI accuracy
│   │   └── README.md
│   │
│   ├── /controllers
│   │   ├── trading.controller.js   # Trading API handlers
│   │   ├── dashboard.controller.js # Dashboard API handlers
│   │   └── README.md
│   │
│   ├── /routes
│   │   ├── trading.routes.js       # Trading API routes
│   │   ├── dashboard.routes.js     # Dashboard routes
│   │   └── README.md
│   │
│   ├── /workers
│   │   ├── tradingWorker.js        # BullMQ trading pipeline
│   │   └── README.md
│   │
│   ├── /models
│   │   ├── trade.model.js          # Trade schema (Mongoose)
│   │   ├── decision.model.js       # AI decision audit schema
│   │   └── README.md
│   │
│   ├── /middleware
│   │   ├── validation.middleware.js # Input validation + auth
│   │   └── README.md
│   │
│   ├── /utils
│   │   ├── logger.js               # Winston structured logging
│   │   ├── helpers.js              # Shared utility functions
│   │   └── README.md
│   │
│   ├── /dashboard
│   │   ├── index.html              # Web dashboard UI
│   │   └── README.md
│   │
│   └── /backtesting
│       ├── backtest.service.js     # Historical simulation engine
│       └── README.md
│
└── /scripts
    ├── testRun.js                  # System validation script
    └── README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 18
- MongoDB (local or Atlas)
- Redis (local or cloud)
- API keys for Binance / Zerodha / Claude

### One-command launch

```bash
# Boots backend (:3000) + worker + frontend (:5173) in one terminal
./start.sh

# Variants
./start.sh --no-worker      # skip BullMQ worker
./start.sh --no-frontend    # backend + worker only
./start.sh --prod           # NODE_ENV=production
```

`start.sh` is a thin wrapper around `node dev.js` which runs preflight
checks (Node ≥ 18, `.env`, Redis, Mongo, ports 3000/5173, `node_modules`),
auto-runs `npm install` when missing, and auto-restarts any child that
crashes.

### Manual setup (if you prefer)

```bash
npm install
cp .env.example .env        # then edit .env with your API keys
npm run test:run            # validate system
npm run dev                 # backend only
open http://localhost:3000/dashboard
```

### See also

- **[VISUAL_ARCHITECTURE.md](./VISUAL_ARCHITECTURE.md)** — diagrams of
  process topology, service graph, event bus, and end-to-end flow.
- **[CHANGELOG.md](./CHANGELOG.md)** — recent changes (Position Monitor,
  Binance OCO, single launcher) and the upcoming roadmap.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — architectural reasoning.

### Running the Worker (Separate Process)

```bash
npm run worker
node scripts/generateZerodhaToken.js

```


### Running a Backtest

```bash
npm run backtest
# Or with custom params:
node src/backtesting/backtest.service.js ETHUSDT binance 5m 50000 1000
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System health check |
| GET | `/api` | API documentation |
| GET | `/api/trading/market-data?symbol=BTCUSDT` | Fetch candle data |
| GET | `/api/trading/indicators?symbol=BTCUSDT` | Compute indicators |
| POST | `/api/trading/trade` | Trigger a trading cycle |
| POST | `/api/trading/ai-analysis` | Get AI analysis only |
| POST | `/api/trading/trade/close` | Close an open trade |
| POST | `/api/trading/watchlist` | Update trading watchlist |
| GET | `/api/trading/queue/status` | Queue statistics |
| GET | `/dashboard` | Legacy static dashboard |

### Dashboard-facing API (`/api/*`)
Used by the React frontend in `/frontend`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/market-data?symbol=BTCUSDT&timeframe=1m` | Live price, candles, indicators |
| GET  | `/api/ai-decision?symbol=BTCUSDT&live=true`    | Latest persisted or fresh Claude decision |
| GET  | `/api/trades?page=1&limit=20&search=BTC&status=OPEN` | Paginated trade history with stats |
| POST | `/api/trades/:tradeId/close`                   | Close an open trade |
| GET  | `/api/status`                                  | Mongo / Redis / Binance / Claude / mode |
| GET  | `/api/logs?limit=50&level=info`                | Recent logs from MongoDB |
| GET  | `/api/pnl-series?days=30`                      | Cumulative PnL series for the equity chart |
| POST | `/api/execute`                                 | Queue a manual trading cycle |
| WS   | `/ws`                                          | Live `price` / `decision` / `trade` / `log` stream |

## 🖥️ React Dashboard (`/frontend`)

```bash
# Terminal 1 — backend (already running on :3000)
npm install
npm start

# Terminal 2 — frontend
cd frontend
npm install
npm run dev          # http://localhost:5173 (proxies /api & /ws to :3000)
npm run build        # production bundle in dist/
```

The frontend stack: **Vite + React 18 + Tailwind + Zustand + Recharts + Axios**.
It connects to `/ws` for real-time price/decision/trade/log streams and falls
back to REST polling automatically if the WebSocket can't connect.

## 🔒 Security

- API keys stored in `.env` (never committed)
- Read + trade-only exchange permissions (NO withdrawals)
- Rate limiting on all API endpoints
- Helmet.js security headers
- Input validation on all endpoints

## 📊 Trading Flow

```
1. Fetch Market Data (Binance/Zerodha)
   ↓
2. Compute Technical Indicators (RSI, MACD, EMA, VWAP)
   ↓
3. Send to Claude AI → Get JSON Decision
   ↓
4. Risk Engine Validation (R:R, confidence, daily loss, position size)
   ↓
5. Execute Trade (if approved) or Reject
   ↓
6. Log Everything (MongoDB + Winston)
```

## ⚙️ Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | MongoDB (Mongoose) |
| Cache/Queue | Redis (ioredis + BullMQ) |
| AI Engine | Claude API (Anthropic SDK) |
| Crypto Exchange | Binance REST + WebSocket |
| Stock Exchange | Zerodha Kite API |
| Indicators | technicalindicators |
| Logging | Winston |
| Security | Helmet, CORS, Rate Limiting |

## 📜 License

MIT
