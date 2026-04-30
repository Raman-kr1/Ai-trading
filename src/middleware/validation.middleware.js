/**
 * Middleware: Input Validation
 * =============================
 */

const logger = require('../utils/logger');

/** Validate symbol parameter exists. */
function validateSymbol(req, res, next) {
  const symbol = req.body.symbol || req.query.symbol;
  if (!symbol || typeof symbol !== 'string' || symbol.length < 2) {
    return res.status(400).json({ error: 'Valid symbol is required' });
  }
  next();
}

/** Validate exchange is supported. */
function validateExchange(req, res, next) {
  const exchange = req.body.exchange || req.query.exchange || 'binance';
  if (!['binance', 'zerodha'].includes(exchange)) {
    return res.status(400).json({ error: 'Unsupported exchange. Use: binance, zerodha' });
  }
  next();
}

/** Basic dashboard auth (Bearer token). */
function dashboardAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  const expectedToken = process.env.DASHBOARD_AUTH_TOKEN;

  if (!expectedToken) return next(); // No auth configured

  if (token !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** Log all incoming requests. */
function requestLogger(req, res, next) {
  logger.debug(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.method === 'POST' ? req.body : undefined,
    ip: req.ip,
  });
  next();
}

module.exports = { validateSymbol, validateExchange, dashboardAuth, requestLogger };
