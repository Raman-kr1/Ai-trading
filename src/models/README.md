# 📁 Models (`/src/models`)

Mongoose schemas for MongoDB persistence.

## Files

| File | Collection | Purpose |
|------|------------|---------|
| `trade.model.js` | `trades` | Stores executed trades with full lifecycle (entry → exit → PnL) |
| `decision.model.js` | `decisions` | Audit trail of every AI decision from Claude |

## Trade Status Lifecycle

```
PENDING → OPEN → FILLED → CLOSED
                    ↘ CANCELLED
REJECTED (failed risk check or execution error)
```

## Indexes

- `trades`: Indexed on `tradeId` (unique), `symbol + createdAt`, `status + createdAt`
- `decisions`: Indexed on `createdAt`, `decision + riskApproved`
