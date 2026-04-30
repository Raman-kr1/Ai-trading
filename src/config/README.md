# 📁 Configuration (`/src/config`)

Centralized configuration management for the AI Trading System.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Loads `.env` variables into a typed config object with validation |
| `database.js` | MongoDB connection manager with retry logic and graceful shutdown |
| `redis.js` | Redis client (ioredis) with BullMQ-compatible settings and cache helpers |

## Environment Variables

All configuration is driven by environment variables. See `.env.example` at the project root for the complete list.

## Architecture Decisions

- **Fail-fast validation**: Missing production keys cause immediate exit — no silent failures
- **Connection retry**: Both MongoDB and Redis implement exponential backoff on connection failure
- **BullMQ compatibility**: Redis client uses `maxRetriesPerRequest: null` as required by BullMQ
- **Cache abstraction**: The `cache` object in `redis.js` provides `get/set/del` with automatic JSON serialization
