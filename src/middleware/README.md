# 📁 Middleware (`/src/middleware`)

Express middleware for request validation, authentication, and logging.

## Files

| File | Purpose |
|------|---------|
| `validation.middleware.js` | Input validation, dashboard auth, and request logging |

## Middleware Functions

| Function | Purpose |
|----------|---------|
| `validateSymbol` | Ensures `symbol` parameter exists and is valid |
| `validateExchange` | Validates exchange is `binance` or `zerodha` |
| `dashboardAuth` | Bearer token authentication for dashboard endpoints |
| `requestLogger` | Logs all incoming requests with query/body details |
