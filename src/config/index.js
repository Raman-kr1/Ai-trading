/**
 * Centralized Configuration Module
 * ---------------------------------
 * Loads all environment variables and exports them as a typed config object.
 * Validates required variables at startup to fail fast on misconfiguration.
 */

require('dotenv').config();

const config = {
  // ── Application ──────────────────────────────────────────────
  app: {
    name: process.env.APP_NAME || 'AI-Trading-System',
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    tradingMode: process.env.TRADING_MODE || 'paper', // 'paper' | 'live'
  },

  // ── Redis ────────────────────────────────────────────────────
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  // ── MongoDB ──────────────────────────────────────────────────
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/ai_trading',
    dbName: process.env.MONGO_DB_NAME || 'ai_trading',
  },

  // ── Binance ──────────────────────────────────────────────────
  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: process.env.BINANCE_TESTNET === 'true',
    baseUrl: process.env.BINANCE_BASE_URL || 'https://testnet.binance.vision',
    wsUrl: process.env.BINANCE_WS_URL || 'wss://testnet.binance.vision/ws',
  },

  // ── Zerodha Kite ─────────────────────────────────────────────
  zerodha: {
    apiKey: process.env.ZERODHA_API_KEY,
    apiSecret: process.env.ZERODHA_API_SECRET,
    accessToken: process.env.ZERODHA_ACCESS_TOKEN,
    baseUrl: process.env.ZERODHA_BASE_URL || 'https://api.kite.trade',
  },

  // ── Claude AI ────────────────────────────────────────────────
  claude: {
    apiKey: process.env.CLAUDE_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS, 10) || 1024,
  },

  // ── Risk Management ──────────────────────────────────────────
  risk: {
    maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT) || 2,
    maxTradeSizePercent: parseFloat(process.env.MAX_TRADE_SIZE_PERCENT) || 5,
    minRiskRewardRatio: parseFloat(process.env.MIN_RISK_REWARD_RATIO) || 2,
    minConfidenceScore: parseFloat(process.env.MIN_CONFIDENCE_SCORE) || 60,
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS, 10) || 5,
    maxExposurePerAssetPercent:
      parseFloat(process.env.MAX_EXPOSURE_PER_ASSET_PERCENT) || 10,
  },

  // ── Scheduler ────────────────────────────────────────────────
  scheduler: {
    tradingIntervalMs: parseInt(process.env.TRADING_INTERVAL_MS, 10) || 60000,
    marketDataCacheTtl: parseInt(process.env.MARKET_DATA_CACHE_TTL, 10) || 30,
  },

  // ── Logging ──────────────────────────────────────────────────
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },

  // ── Dashboard ────────────────────────────────────────────────
  dashboard: {
    enabled: process.env.DASHBOARD_ENABLED === 'true',
    authToken: process.env.DASHBOARD_AUTH_TOKEN,
  },
};

/**
 * Validate that critical environment variables are set.
 * In production, missing keys cause immediate process exit.
 */
function validateConfig() {
  const requiredInProduction = [
    { key: 'CLAUDE_API_KEY', value: config.claude.apiKey },
  ];

  const warnings = [];

  for (const { key, value } of requiredInProduction) {
    if (!value && config.app.env === 'production') {
      console.error(`❌ FATAL: Missing required env variable: ${key}`);
      process.exit(1);
    } else if (!value) {
      warnings.push(`⚠️  Missing env variable: ${key} (OK in dev, required in production)`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n📋 Configuration Warnings:');
    warnings.forEach((w) => console.log(`   ${w}`));
    console.log('');
  }
}

validateConfig();

module.exports = config;
