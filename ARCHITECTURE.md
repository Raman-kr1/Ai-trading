# 🏗️ Architecture Document

## System Architecture

### Overview

The AI Trading System follows a **modular service-oriented architecture** where each component has a single responsibility and communicates through well-defined interfaces. The system is designed for horizontal scalability — the API server and trading workers can run as separate processes.

### Architectural Principles

1. **Separation of Concerns** — Each service handles exactly one domain
2. **Defense in Depth** — AI decisions are always validated by the risk engine
3. **Fail-Safe Defaults** — On any error, the system defaults to HOLD (no trade)
4. **Audit Everything** — Every AI decision is persisted, regardless of execution
5. **Paper-First** — All development/testing happens in paper trading mode

---

## Component Deep Dive

### 1. Market Data Service

**Responsibility**: Fetch and normalize real-time market data from multiple exchanges.

```
                    ┌───────────┐
                    │  Binance  │──── REST (klines)
                    │    API    │──── WebSocket (live stream)
 Market Data ◄─────│           │
  Service          └───────────┘
      │             ┌───────────┐
      └─────────────│  Zerodha  │──── REST (historical)
                    │ Kite API  │──── REST (quotes)
                    └───────────┘
                         │
                    ┌────▼──────┐
                    │   Redis   │ ← Cached with TTL
                    │   Cache   │
                    └───────────┘
```

**Key Design Decisions**:
- All candle data is normalized to a common `{ timestamp, open, high, low, close, volume, source }` format
- Redis caching with configurable TTL prevents redundant API calls
- WebSocket reconnection with exponential backoff
- Multi-timeframe support for advanced strategies

### 2. Indicator Engine

**Responsibility**: Compute technical indicators from normalized candle data.

| Indicator | Configuration | Signal |
|-----------|--------------|--------|
| RSI(14) | Period: 14 | >70 Overbought, <30 Oversold |
| MACD(12,26,9) | Fast: 12, Slow: 26, Signal: 9 | Histogram direction + crossover |
| EMA(20) | Period: 20 | Short-term trend |
| EMA(50) | Period: 50 | Medium-term trend |
| VWAP | Full session | Price relative to volume-weighted average |

**Output**: Structured object with raw values + derived trend signals (`BULLISH`, `BEARISH`, `NEUTRAL`).

### 3. AI Decision Engine (Claude)

**Responsibility**: Analyze market data and indicators to produce trading decisions.

**Prompt Engineering Strategy**:
- System prompt constrains output to strict JSON format
- No free-text responses allowed — only `{ decision, entry_price, stop_loss, target_price, confidence, reasoning }`
- Response parser handles edge cases: markdown-wrapped JSON, missing fields, invalid values
- Graceful fallback to HOLD on API failures

**Security**:
- API key never exposed in responses
- Confidence clamped to 0-100 range
- Decision values validated against whitelist (BUY/SELL/HOLD)

### 4. Risk Engine

**Responsibility**: Enforce non-negotiable risk management rules that override AI decisions.

```
AI Decision
    │
    ▼
┌─────────────────────────────────────┐
│         Risk Engine Rules           │
│                                     │
│  ✓ Risk/Reward ≥ 1:2              │
│  ✓ Confidence ≥ 60%               │
│  ✓ Daily loss < 2% of capital     │
│  ✓ Trade size < 5% of capital     │
│  ✓ Open positions < max limit      │
│  ✓ Valid price levels              │
│  ✓ Stop/target consistency         │
│                                     │
│  ANY FAIL → TRADE REJECTED         │
└─────────────────────────────────────┘
    │
    ▼
Execute or Reject
```

**This is the critical safety layer** — the risk engine has absolute veto power over the AI.

### 5. Execution Service

**Responsibility**: Place orders on exchanges or simulate paper trades.

| Mode | Behavior |
|------|----------|
| `paper` | Simulates order with 0.1% slippage and mock fees |
| `live` | Places real MARKET orders via exchange API |

**Safety Features**:
- Trading mode is set via environment variable
- Failed executions are logged as REJECTED trades
- No withdrawal permissions — API keys are read + trade only

### 6. Worker / Scheduler

**Responsibility**: Run the full trading pipeline on a schedule.

```
BullMQ Queue (Redis)
    │
    ▼ Every 60s (configurable)
┌─────────────────────────────┐
│   Trading Pipeline Job      │
│                             │
│  1. Fetch Market Data       │ 10%
│  2. Compute Indicators      │ 30%
│  3. Get AI Decision         │ 50%
│  4. Risk Validation         │ 70%
│  5. Execute Trade           │ 90%
│  6. Log Result              │ 100%
└─────────────────────────────┘
```

**Reliability Features**:
- BullMQ with Redis ensures jobs survive process restarts
- 2 retry attempts with exponential backoff
- Concurrency: 1 (prevents race conditions on balance/position checks)
- Rate limited: max 10 jobs per minute

---

## Data Flow Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Binance   │────→│  Market Data │────→│  Indicator  │
│   Zerodha   │     │   Service    │     │   Engine    │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │                     │
                    ┌──────▼───────┐      ┌──────▼──────┐
                    │    Redis     │      │   Claude    │
                    │    Cache     │      │   AI API    │
                    └──────────────┘      └──────┬──────┘
                                                 │
                                          ┌──────▼──────┐
                                          │    Risk     │
                                          │   Engine    │
                                          └──────┬──────┘
                                                 │
                    ┌──────────────┐       ┌─────▼──────┐
                    │   MongoDB    │◄──────│ Execution  │
                    │ (Trades +    │       │  Service   │
                    │  Decisions)  │       └────────────┘
                    └──────────────┘
```

---

## Error Handling Strategy

| Layer | Strategy |
|-------|----------|
| Market Data | Retry with backoff, return cached data on failure |
| Indicators | Return `null` on insufficient data, log warning |
| AI Engine | Return HOLD with confidence=0 on API failure |
| Risk Engine | Default reject on any evaluation error |
| Execution | Log REJECTED trade on order failure |
| Worker | Retry job 2x, then mark as failed |

---

## Scalability Considerations

1. **Horizontal**: API server and worker can run as separate processes
2. **Queue-based**: BullMQ decouples request handling from pipeline execution
3. **Stateless services**: All state lives in Redis/MongoDB
4. **Connection pooling**: MongoDB pool size: 10, Redis single connection
5. **Rate limiting**: Respects exchange API rate limits
