# Visual Architecture

A bird's-eye, code-accurate map of the AI Trading System after the
Position Monitor lands. Every box maps to a real file in `src/`.

---

## 1. Process topology — what `./start.sh` actually starts

```
                              ./start.sh  →  node dev.js
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
   ┌────────▼────────┐       ┌─────────▼─────────┐       ┌────────▼────────┐
   │  BACKEND        │       │  WORKER           │       │  FRONTEND       │
   │  (cyan)         │       │  (yellow)         │       │  (magenta)      │
   │                 │       │                   │       │                 │
   │  node           │       │  node             │       │  npm run dev    │
   │  src/server.js  │       │  src/workers/     │       │  (Vite + React) │
   │  :3000          │       │  tradingWorker.js │       │  :5173          │
   │                 │       │                   │       │                 │
   │  HTTP + WS      │       │  BullMQ consumer  │       │  Proxies:       │
   │  /api  /ws      │       │  on Redis queue   │       │  /api → :3000   │
   └─┬─────────────┬─┘       └─┬───────────┬─────┘       │  /ws  → :3000   │
     │             │           │           │             └────────┬────────┘
     │             │           │           │                      │
     ▼             ▼           ▼           ▼                      ▼
 ┌───────┐   ┌──────────┐  ┌───────┐  ┌────────┐           ┌──────────────┐
 │MongoDB│   │  Redis   │  │ Mongo │  │ Redis  │           │   Browser    │
 │ :27017│   │  :6379   │  │       │  │ BullMQ │           │  React app   │
 └───────┘   └──────────┘  └───────┘  └────────┘           └──────────────┘
```

`dev.js` runs colour-coded preflight checks (Node ≥ 18, `.env`, port
3000/5173 free, Mongo + Redis reachable, `node_modules` present),
auto-runs `npm install` if missing, spawns each child with auto-restart
after 3 s on crash, and gracefully SIGTERMs them all on `Ctrl+C`.

---

## 2. Backend service graph (inside `node src/server.js`)

```
                ┌──────────────────────────────────────────────┐
                │             Express app (src/app.js)         │
                │  helmet · cors · rate-limit · morgan         │
                └───────────────┬──────────────────────────────┘
                                │
   ┌────────────────────────────┴──────────────────────────────┐
   │                                                            │
   ▼                                                            ▼
 ┌─────────────────────────────┐              ┌──────────────────────────┐
 │  /api/* routes              │              │  /api/trading/* routes   │
 │  (frontend dashboard)       │              │  (legacy / programmatic) │
 │  src/routes/api.routes.js   │              │  src/routes/trading.*    │
 │                             │              │                          │
 │  market-data    ai-decision │              │  market-data  indicators │
 │  trades         status      │              │  trade        ai-analysis│
 │  logs           pnl-series  │              │  trade/close             │
 │  execute        positions ← │  NEW         │  watchlist  queue/status │
 │  trades/:id/close           │              │                          │
 └──────────┬──────────────────┘              └────────────┬─────────────┘
            │                                              │
            ▼                                              ▼
 ┌───────────────────────────────────────────────────────────────────┐
 │                    src/controllers/api.controller.js              │
 │                    src/controllers/trading.controller.js          │
 └───────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │                         SERVICE  LAYER                             │
 │                                                                    │
 │  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌────────────────┐  │
 │  │ marketData │→ │ indicator  │→ │   ai     │→ │     risk       │  │
 │  │  .service  │  │  .service  │  │ .service │  │   .service     │  │
 │  │ Binance/   │  │ RSI/EMA/   │  │ Claude   │  │ R:R, daily     │  │
 │  │ Zerodha    │  │ MACD/VWAP  │  │ JSON     │  │ loss, size     │  │
 │  └────────────┘  └────────────┘  └──────────┘  └───────┬────────┘  │
 │                                                         │           │
 │  ┌──────────────────┐  ┌──────────────┐  ┌──────────────▼─────────┐ │
 │  │ analytics        │  │ backtesting  │  │   execution.service    │ │
 │  │ .service         │  │ .service     │  │   ─ paper sim          │ │
 │  │ PnL · win-rate   │  │ historical   │  │   ─ Binance MARKET +   │ │
 │  │ AI accuracy      │  │ replay       │  │     OCO (NEW)          │ │
 │  └──────────────────┘  └──────────────┘  │   ─ Zerodha MARKET     │ │
 │                                          └─────────┬──────────────┘ │
 │                                                    │                │
 │  ┌────────────────────────────────────────────────▼───────────────┐ │
 │  │                  positionMonitor.service       (NEW)            │ │
 │  │  loads OPEN trades · listens bus.price · evaluates SL/TP        │ │
 │  │  every tick · calls executionService.closeTrade · emits         │ │
 │  │  position:exit · 30 s reconciler · OCO redundancy on Binance    │ │
 │  └─────────────────────────────────────────────────────────────────┘ │
 │                                                                     │
 │  ┌─────────────────────────────────────────────────────────────────┐ │
 │  │                     websocket.service (/ws)                     │ │
 │  │  WebSocket.Server attached to the same http.Server              │ │
 │  │  Channels broadcast: price · candle · decision · trade ·        │ │
 │  │            trade:closed · position:exit (NEW) · log · status    │ │
 │  └─────────────────────────────────────────────────────────────────┘ │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## 3. The event bus — the spine of real-time updates

Every component pushes events through one process-wide `EventEmitter`
(`src/utils/eventBus.js`). The WebSocket service is the only consumer
that broadcasts to browsers; the position monitor is a consumer too.

```
   ┌──────────────┐   emit('decision')   ┌──────────────────────┐
   │ tradingWorker│──────────────────────▶                      │
   └──────────────┘                      │                      │
   ┌──────────────┐   emit('trade')      │                      │
   │ execution    │──────────────────────▶                      │
   │ .service     │   emit('trade:closed')                      │
   └──────────────┘──────────────────────▶                      │
   ┌──────────────┐   emit('log')        │   utils/eventBus.js  │
   │ logger       │──────────────────────▶   (EventEmitter)     │
   │ (winston)    │                      │                      │
   └──────────────┘                      │                      │
   ┌──────────────┐   emit('price')      │                      │
   │ marketData   │──────────────────────▶                      │
   │ .service WS  │   emit('candle')     │                      │
   └──────────────┘──────────────────────▶                      │
   ┌──────────────┐   emit('position:    │                      │
   │ position     │   exit')             │                      │
   │ Monitor      │──────────────────────▶                      │
   └──────────────┘                      └──┬──────────────────┬┘
                                            │                  │
                                            ▼                  ▼
                                  ┌─────────────────┐  ┌─────────────────┐
                                  │ websocket       │  │ positionMonitor │
                                  │ .service        │  │ .service        │
                                  │ → broadcasts to │  │ → reacts to     │
                                  │   /ws clients   │  │   'price' ticks │
                                  └─────────────────┘  └─────────────────┘
```

---

## 4. End-to-end flow of a single trading cycle

```
        every 60 s, BullMQ fires a job
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │ 1. tradingWorker.js receives job    │
   └──────────────┬──────────────────────┘
                  ▼
   ┌─────────────────────────────────────┐
   │ 2. marketData.service               │
   │    fetches klines + ticker          │
   │    (Redis cache 30 s)               │
   └──────────────┬──────────────────────┘
                  ▼
   ┌─────────────────────────────────────┐
   │ 3. indicator.service                │
   │    RSI · MACD · EMA · VWAP          │
   └──────────────┬──────────────────────┘
                  ▼
   ┌─────────────────────────────────────┐
   │ 4. ai.service → Claude              │
   │    strict JSON: decision, conf,     │
   │    entry, stop_loss, target         │
   └──────────────┬──────────────────────┘
                  ▼
   ┌─────────────────────────────────────┐    REJECT
   │ 5. risk.service                     │────────────▶ log Decision (no trade)
   │    R:R ≥ 2 · conf ≥ 60              │
   │    daily loss · position size       │
   │    max open positions               │
   └──────────────┬──────────────────────┘
                  │ APPROVE
                  ▼
   ┌─────────────────────────────────────┐
   │ 6. execution.service.executeTrade   │
   │    paper sim │ Binance MARKET + OCO │
   │              │ Zerodha MARKET       │
   │    persists Trade(status=OPEN)      │
   │    emit('trade')                    │
   └──────────────┬──────────────────────┘
                  ▼
   ┌─────────────────────────────────────┐
   │ 7. positionMonitor picks it up      │
   │    via bus.on('trade')              │  ← live tick loop begins
   └──────────────┬──────────────────────┘
                  ▼
        ┌─────────┴──────────┐
        │                    │
        ▼                    ▼
  price ≤ stopLoss     price ≥ targetPrice
        │                    │
        └────────┬───────────┘
                 ▼
   ┌─────────────────────────────────────┐
   │ 8. executionService.closeTrade      │
   │    PnL persisted · status=CLOSED    │
   │    emit('trade:closed')             │
   │    emit('position:exit')            │
   └──────────────┬──────────────────────┘
                  ▼
   ┌─────────────────────────────────────┐
   │ 9. websocket.service broadcasts to  │
   │    every dashboard tab in real time │
   └─────────────────────────────────────┘
```

---

## 5. Frontend ↔ backend wiring

```
   ┌──────────────────────────────────────────────────────────────┐
   │  React app (frontend/src)                                    │
   │                                                              │
   │  pages/Dashboard.jsx                                         │
   │   ├─ components/PriceChart.jsx     (Recharts)                │
   │   ├─ components/TradePanel.jsx     (Execute button)          │
   │   ├─ components/TradeHistory.jsx   (paginated)               │
   │   ├─ components/SystemStatus.jsx                             │
   │   ├─ components/LogsViewer.jsx                               │
   │   └─ components/Toasts.jsx                                   │
   │                                                              │
   │  store/useStore.js   ← Zustand, single source of truth       │
   │  hooks/useWebSocket  ← /ws subscription + REST fallback      │
   │  services/api.js     ← axios w/ retry interceptor            │
   └────────────────────┬─────────────────────────┬───────────────┘
                        │ HTTP                    │ WebSocket
                        ▼                         ▼
              ┌────────────────────────────────────────┐
              │  Vite dev server :5173                 │
              │  proxy:  /api → :3000  (REST)          │
              │          /ws  → :3000  (WS upgrade)    │
              └────────────────────┬───────────────────┘
                                   │
                                   ▼
              ┌────────────────────────────────────────┐
              │  Express + ws on :3000                 │
              │  /api/*    → controllers               │
              │  /ws       → websocket.service         │
              └────────────────────────────────────────┘
```

---

## 6. File map (only what matters)

```
/Users/ramank029/Desktop/Raman-test/Ai-trading
├── start.sh                          ← single-command launcher (NEW)
├── dev.js                            ← unified Node launcher
├── package.json                      ← scripts: dev:all, dev, worker, …
├── .env                              ← config + secrets
├── README.md
├── ARCHITECTURE.md                   ← deep architectural reasoning
├── VISUAL_ARCHITECTURE.md            ← THIS FILE — diagrams
├── CHANGELOG.md                      ← what shipped + roadmap (NEW)
│
├── src/
│   ├── server.js                     ← http.Server + WS attach + monitor
│   ├── app.js                        ← Express middleware + route mount
│   │
│   ├── config/
│   │   ├── index.js                  ← env validation + central config
│   │   ├── database.js               ← MongoDB (mongoose) connector
│   │   └── redis.js                  ← ioredis + cache helpers
│   │
│   ├── services/
│   │   ├── marketData.service.js     ← Binance/Zerodha REST + WS
│   │   ├── indicator.service.js      ← RSI · MACD · EMA · VWAP
│   │   ├── ai.service.js             ← Claude JSON inference
│   │   ├── risk.service.js           ← deterministic risk gate
│   │   ├── execution.service.js      ← paper / Binance / Zerodha + OCO (NEW)
│   │   ├── positionMonitor.service.js← SL/TP enforcer (NEW)
│   │   ├── websocket.service.js      ← /ws fan-out, position:exit channel
│   │   ├── analytics.service.js      ← PnL · win-rate · AI accuracy
│   │   └── hft.service.js            ← in-memory order books
│   │
│   ├── controllers/
│   │   ├── api.controller.js         ← dashboard endpoints
│   │   └── trading.controller.js     ← legacy /api/trading endpoints
│   │
│   ├── routes/
│   │   ├── api.routes.js             ← /api/* (incl. /api/positions NEW)
│   │   ├── trading.routes.js         ← /api/trading/*
│   │   └── dashboard.routes.js       ← /dashboard
│   │
│   ├── workers/
│   │   └── tradingWorker.js          ← BullMQ consumer, 60 s loop
│   │
│   ├── models/
│   │   ├── trade.model.js            ← OPEN/CLOSED · SL · TP · PnL
│   │   ├── decision.model.js         ← AI audit log
│   │   └── log.model.js              ← TTL-indexed log store
│   │
│   ├── middleware/
│   │   └── validation.middleware.js  ← input + dashboard auth
│   │
│   ├── utils/
│   │   ├── eventBus.js               ← process-wide EventEmitter
│   │   ├── logger.js                 ← winston + Mongo + bus transports
│   │   ├── helpers.js                ← HMAC, retry, normalize
│   │   └── performance.js            ← keep-alive http agents
│   │
│   ├── backtesting/
│   │   └── backtest.service.js       ← historical replay (P1: Sharpe/DD)
│   │
│   └── dashboard/
│       └── index.html                ← legacy static dashboard
│
├── frontend/
│   ├── vite.config.js                ← :5173, /api + /ws proxy → :3000
│   ├── tailwind.config.js
│   └── src/
│       ├── App.jsx
│       ├── pages/Dashboard.jsx
│       ├── components/{PriceChart,TradePanel,TradeHistory,…}.jsx
│       ├── store/useStore.js         ← Zustand
│       ├── hooks/useWebSocket.js     ← /ws + REST fallback
│       └── services/api.js           ← axios client
│
└── scripts/
    ├── testRun.js                    ← system validation
    └── testPositionMonitor.js        ← Position Monitor smoke test (NEW)
```

---

## 7. How to run

```bash
# one command starts backend + worker + frontend
./start.sh

# or any of these subsets
./start.sh --no-worker
./start.sh --no-frontend
./start.sh --prod

# direct (same effect as start.sh, no shell wrapper)
node dev.js
```

After boot:

| URL                                | What                                     |
|------------------------------------|------------------------------------------|
| http://localhost:5173              | React dashboard (development)            |
| http://localhost:3000/health       | Backend health                           |
| http://localhost:3000/api/status   | Service health (Mongo/Redis/Binance/AI)  |
| http://localhost:3000/api/positions| Live position-monitor snapshot           |
| ws://localhost:3000/ws             | Real-time event stream                   |
