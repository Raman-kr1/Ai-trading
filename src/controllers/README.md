# 📁 Controllers (`/src/controllers`)

HTTP request/response handlers. Controllers are thin — they delegate all business logic to services.

## Files

| File | Purpose |
|------|---------|
| `trading.controller.js` | Handles trading API endpoints (market data, indicators, trade execution, queue) |
| `dashboard.controller.js` | Serves the web dashboard and analytics API |

## Pattern

```
Route → Controller → Service → Database/API
```

Controllers only handle:
- Request parameter extraction and validation
- Calling the appropriate service
- Formatting the response
- Error response formatting
