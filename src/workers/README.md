# 📁 Workers (`/src/workers`)

Background job processing using BullMQ with Redis.

## Files

| File | Purpose |
|------|---------|
| `tradingWorker.js` | Orchestrates the full trading pipeline as background jobs |

## Architecture

```
Scheduler → BullMQ Queue → Worker → Pipeline
                                      ├── Fetch Data
                                      ├── Compute Indicators
                                      ├── AI Decision
                                      ├── Risk Validation
                                      └── Execute Trade
```

## Running

```bash
# As part of the main server (in-process)
npm start

# As a standalone worker (separate process)
npm run worker
```

## Job Configuration

- **Concurrency**: 1 (sequential execution to avoid race conditions)
- **Rate Limit**: Max 10 jobs per minute
- **Retry**: 2 attempts with exponential backoff
- **Cleanup**: Last 100 completed / 50 failed jobs retained
