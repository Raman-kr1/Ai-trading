# Changelog

All notable changes to the AI Trading System.

## [Unreleased] — 2026-05-01

### Added — Position Monitor (Item A from the agentic-AI roadmap)

The biggest safety hole in the codebase was that `executeTrade()` opened
positions with stop-loss/target prices stored in MongoDB but **nothing
actively closed them**. Exits relied on a manual API call. That defect
is now plugged.

- **`src/services/positionMonitor.service.js`** (new, ~200 LOC)
  - Loads every `Trade` with `status='OPEN'` into memory on boot.
  - Subscribes to `bus.on('price')` — the same firehose the dashboard
    consumes — and evaluates each tracked trade per tick.
  - Picks up newly-created trades via `bus.on('trade')`.
  - Evicts closed trades via `bus.on('trade:closed')`.
  - 30-second reconciler re-reads MongoDB to self-heal missed events.
  - On SL/TP hit: calls `executionService.closeTrade(tradeId, exitPrice)`
    and emits `position:exit` with full PnL payload.

- **`src/services/execution.service.js`** — added `placeBinanceOco()`
  that lodges a One-Cancels-Other order pairing the stop-loss and
  take-profit on Binance itself, so exits trigger even if our process
  dies. Failure is non-fatal — the in-process monitor remains the
  primary exit path.

- **`src/server.js`** — starts the monitor after the WebSocket attaches
  and stops it on graceful shutdown.

- **`src/routes/api.routes.js`** — new `GET /api/positions` returns the
  live in-memory snapshot `{ tracked, closing, trades[] }`.

- **`src/services/websocket.service.js`** — `position:exit` added to the
  broadcast channel list so the dashboard can surface a toast the moment
  an SL/TP fires.

- **`scripts/testPositionMonitor.js`** — smoke test (passing): inserts a
  synthetic OPEN trade, injects a price tick, and asserts that the
  monitor closes the trade with the expected PnL.

### Added — Frontend changes for the Position Monitor

- **`frontend/src/hooks/useWebSocket.js`** — subscribes to the new
  `position:exit` channel and surfaces a contextual toast: green for
  TAKE_PROFIT hits, red for STOP_LOSS, with the exit price and PnL.
- **`frontend/src/services/api.js`** — adds `api.positions()` for the
  new REST endpoint.
- **`frontend/src/components/OpenPositions.jsx`** (new) — live panel
  showing every trade the monitor is watching, with side badge, entry,
  SL, TP, and live distance-to-threshold percentages.
- **`frontend/src/pages/Dashboard.jsx`** — mounts `OpenPositions`
  between SystemStatus and PnLChart in the right rail.

Production build: `vite build` ✅ 719 modules, 623 KB minified
(181 KB gzip).

### Added — Single-command launcher

- **`start.sh`** — thin shell wrapper around `node dev.js` so the project
  starts with one command (`./start.sh`). Forwards the existing flags:
  `--no-worker`, `--no-frontend`, `--prod`.

- **`dev.js`** (already existed) — orchestrates backend, frontend, and
  worker in one terminal with colour-coded prefixes, auto-restart on
  crash, pre-flight checks (Node version, `.env`, Redis, Mongo, ports,
  `node_modules`), and clean SIGTERM-then-SIGKILL shutdown.

### Verified

End-to-end smoke test on `./start.sh`:

| Check                             | Result |
|-----------------------------------|--------|
| Backend `:3000` boots             | ✅ |
| Frontend `:5173` HTTP 200         | ✅ |
| Vite proxy `/api/status` → backend | ✅ Same JSON |
| All 4 services connected          | ✅ Mongo / Redis / Binance / Claude |
| Position monitor starts           | ✅ "tracking 0 open trade(s)" |
| `GET /api/positions`              | ✅ `{tracked:0,closing:0,trades:[]}` |
| Synthetic SL/TP test              | ✅ TAKE_PROFIT exit + PnL persisted |

### Known Issues

- Binance **testnet** kline WebSocket occasionally returns 404 on
  reconnect (`wss://testnet.binance.vision/ws/btcusdt@kline_1m`). This
  is a known testnet flakiness, not a code bug — the auto-reconnect
  loop in `marketData.service.js` recovers within seconds.
- Claude API key in `.env` should be rotated; it was committed to a
  prior history snapshot. (P0 in the security backlog.)

---

## Roadmap (next, in order)

| # | Item                                            | Status      |
|---|-------------------------------------------------|-------------|
| A | Position monitor + auto SL/TP                   | ✅ Done      |
| D | Kill switch + reconciler + dashboard auth       | ⏭ Next      |
| C | Real backtest engine (Sharpe, drawdown, walk-fwd)| Pending     |
| B | Tool-use agentic Claude loop with memory store   | Pending     |
