/**
 * Express Application Setup
 * ==========================
 * Configures middleware, routes, and error handling.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('./config');
const { requestLogger } = require('./middleware/validation.middleware');

const app = express();

// ── Security Middleware ────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled for dashboard inline scripts
app.use(cors({
  origin: (origin, cb) => cb(null, true), // Vite dev server / any origin in dev
  credentials: true,
}));

// ── Rate Limiting ──────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 600, // dashboard polls a few endpoints every 1–5s
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Body Parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── HTTP Logging ───────────────────────────────────────────────
if (config.app.env !== 'test') {
  app.use(morgan('short'));
}
app.use(requestLogger);

// ── Static Files (Dashboard) ──────────────────────────────────
app.use('/dashboard/static', express.static(path.join(__dirname, 'dashboard')));

// ── Routes ─────────────────────────────────────────────────────
app.use('/api/trading', require('./routes/trading.routes'));
app.use('/api', require('./routes/api.routes')); // Frontend-facing aliases
app.use('/dashboard', require('./routes/dashboard.routes'));

// ── Health Check ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: config.app.name,
    mode: config.app.tradingMode,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── API Info ───────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: config.app.name,
    version: '1.0.0',
    mode: config.app.tradingMode,
    endpoints: {
      health: 'GET /health',
      // Dashboard-facing
      frontendMarketData: 'GET /api/market-data?symbol=BTCUSDT',
      frontendAiDecision: 'GET /api/ai-decision?symbol=BTCUSDT',
      frontendTrades: 'GET /api/trades?page=1&limit=20',
      frontendStatus: 'GET /api/status',
      frontendLogs: 'GET /api/logs?limit=50',
      frontendPnlSeries: 'GET /api/pnl-series?days=30',
      frontendExecute: 'POST /api/execute',
      websocket: 'WS /ws',
      // Internal/legacy
      tradingMarketData: 'GET /api/trading/market-data?symbol=BTCUSDT',
      tradingIndicators: 'GET /api/trading/indicators?symbol=BTCUSDT',
      triggerTrade: 'POST /api/trading/trade',
      aiAnalysis: 'POST /api/trading/ai-analysis',
      closeTrade: 'POST /api/trading/trade/close',
      watchlist: 'POST /api/trading/watchlist',
      queueStatus: 'GET /api/trading/queue/status',
      dashboard: 'GET /dashboard',
      stats: 'GET /dashboard/api/stats',
    },
  });
});

// ── 404 Handler ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error Handler ──────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const logger = require('./utils/logger');
  logger.error('Unhandled error:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
