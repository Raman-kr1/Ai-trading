# 📁 Scripts (`/scripts`)

Utility scripts for testing, debugging, and maintenance.

## Files

| File | Purpose |
|------|---------|
| `testRun.js` | Validates all system components without external dependencies |

## Usage

```bash
npm run test:run
```

## What It Tests

1. **Configuration** — Environment loading and validation
2. **Indicator Engine** — RSI, MACD, EMA, VWAP computation on mock data
3. **AI Parser** — JSON response parsing including markdown-wrapped responses
4. **Risk Engine** — Trade validation against all risk rules
5. **Utilities** — ID generation, normalization, math helpers
