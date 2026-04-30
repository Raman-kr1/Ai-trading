/**
 * Trading Worker (BullMQ)
 * ========================
 * Background worker that runs the full trading pipeline on a schedule.
 * Uses BullMQ for reliable job processing with Redis as the backend.
 *
 * Pipeline: Fetch Data → Compute Indicators → AI Decision → Risk Check → Execute
 */

const { Queue, Worker } = require('bullmq');
const config = require('../config');
const { redisClient } = require('../config/redis');
const { connectDatabase } = require('../config/database');
const marketDataService = require('../services/marketData.service');
const indicatorService = require('../services/indicator.service');
const aiService = require('../services/ai.service');
const riskService = require('../services/risk.service');
const executionService = require('../services/execution.service');
const Decision = require('../models/decision.model');
const logger = require('../utils/logger');

// ─── Queue Setup ───────────────────────────────────────────────

const QUEUE_NAME = 'trading-pipeline';

const tradingQueue = new Queue(QUEUE_NAME, {
  connection: {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
  },
});

// ─── Trading Pipeline Job Handler ──────────────────────────────

/**
 * Process a single trading cycle for one symbol.
 */
async function processTradingJob(job) {
  const { symbol, exchange, timeframe, capital } = job.data;
  const startTime = Date.now();

  logger.info(`🔄 Trading pipeline started: ${symbol} [${exchange}]`, { jobId: job.id });

  try {
    // Step 1: Fetch market data
    job.updateProgress(10);
    let candles;
    if (exchange === 'binance') {
      candles = await marketDataService.fetchBinanceKlines(symbol, timeframe || '1m', 100);
    } else if (exchange === 'zerodha') {
      candles = await marketDataService.fetchZerodhaCandles(symbol, timeframe || 'minute');
    }

    if (!candles || candles.length < 26) {
      logger.warn(`Insufficient data for ${symbol}: ${candles?.length || 0} candles`);
      return { status: 'skipped', reason: 'Insufficient candle data' };
    }

    // Step 2: Compute indicators
    job.updateProgress(30);
    const indicators = indicatorService.computeAllIndicators(candles);
    if (!indicators) {
      return { status: 'skipped', reason: 'Indicator computation failed' };
    }

    // Step 3: Get AI decision
    job.updateProgress(50);
    const decision = await aiService.getTradeDecision(symbol, indicators, candles, exchange);

    // Step 4: Log the AI decision
    const decisionRecord = await Decision.create({
      symbol, exchange, timeframe: timeframe || '1m',
      decision: decision.decision, entryPrice: decision.entry_price,
      stopLoss: decision.stop_loss, targetPrice: decision.target_price,
      confidence: decision.confidence, reasoning: decision.reasoning,
      indicators: {
        rsi: indicators.rsi, macd: indicators.macd,
        ema20: indicators.ema20, ema50: indicators.ema50,
        vwap: indicators.vwap, currentPrice: indicators.currentPrice,
      },
      marketData: candles[candles.length - 1],
      model: decision._meta?.model,
      promptTokens: decision._meta?.promptTokens,
      completionTokens: decision._meta?.completionTokens,
      latencyMs: decision._meta?.latencyMs,
    });

    // Step 5: Risk validation
    job.updateProgress(70);
    if (decision.decision === 'HOLD') {
      decisionRecord.riskApproved = false;
      decisionRecord.riskReasons = ['HOLD decision'];
      await decisionRecord.save();
      logger.info(`HOLD for ${symbol} — no trade`);
      return { status: 'hold', symbol, confidence: decision.confidence };
    }

    const quantity = riskService.calculatePositionSize(
      capital || 10000, decision.entry_price, decision.stop_loss
    );
    decision.quantity = quantity;

    const riskCheck = await riskService.validateTrade(decision, capital || 10000, symbol);
    decisionRecord.riskApproved = riskCheck.approved;
    decisionRecord.riskReasons = riskCheck.reasons;

    if (!riskCheck.approved) {
      await decisionRecord.save();
      logger.info(`❌ Trade REJECTED by risk engine: ${symbol}`, { reasons: riskCheck.reasons });
      return { status: 'rejected', symbol, reasons: riskCheck.reasons };
    }

    // Step 6: Execute trade
    job.updateProgress(90);
    const trade = await executionService.executeTrade({
      symbol, exchange, decision, riskCheck, quantity,
      aiDecisionId: decisionRecord._id,
    });

    decisionRecord.executed = true;
    decisionRecord.tradeId = trade.tradeId;
    await decisionRecord.save();

    const elapsed = Date.now() - startTime;
    logger.info(`✅ Pipeline complete: ${symbol} in ${elapsed}ms`, {
      tradeId: trade.tradeId, side: decision.decision, confidence: decision.confidence,
    });

    return {
      status: 'executed', tradeId: trade.tradeId,
      symbol, side: decision.decision, confidence: decision.confidence,
      elapsed,
    };
  } catch (error) {
    logger.error(`Pipeline error for ${symbol}:`, { error: error.message, stack: error.stack });
    throw error;
  }
}

// ─── Worker Instance ───────────────────────────────────────────

function startWorker() {
  const worker = new Worker(QUEUE_NAME, processTradingJob, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
    },
    concurrency: 1, // Process one symbol at a time to avoid race conditions
    limiter: { max: 10, duration: 60000 }, // Max 10 jobs per minute
  });

  worker.on('completed', (job, result) => {
    logger.info(`Job completed: ${job.id}`, { result });
  });

  worker.on('failed', (job, error) => {
    logger.error(`Job failed: ${job?.id}`, { error: error.message });
  });

  logger.info(`🚀 Trading worker started. Queue: ${QUEUE_NAME}`);
  return worker;
}

// ─── Schedule Jobs ─────────────────────────────────────────────

/**
 * Add a trading job to the queue.
 */
async function addTradingJob(symbol, exchange = 'binance', options = {}) {
  const job = await tradingQueue.add('trade-cycle', {
    symbol, exchange, timeframe: options.timeframe || '1m',
    capital: options.capital || 10000,
  }, {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  });

  logger.info(`Job added: ${job.id} for ${symbol} [${exchange}]`);
  return job;
}

/**
 * Add recurring jobs via cron-like scheduling.
 */
async function scheduleRecurringJobs(symbols) {
  // Clear existing repeatable jobs
  const repeatables = await tradingQueue.getRepeatableJobs();
  for (const job of repeatables) {
    await tradingQueue.removeRepeatableByKey(job.key);
  }

  for (const { symbol, exchange } of symbols) {
    await tradingQueue.add(
      'trade-cycle',
      { symbol, exchange, timeframe: '1m', capital: 10000 },
      {
        repeat: { every: config.scheduler.tradingIntervalMs },
        removeOnComplete: 100,
        removeOnFail: 50,
      }
    );
    logger.info(`Scheduled recurring job: ${symbol} [${exchange}] every ${config.scheduler.tradingIntervalMs}ms`);
  }
}

// ─── Standalone Worker Startup ─────────────────────────────────

if (require.main === module) {
  (async () => {
    await connectDatabase();
    startWorker();

    // Default watchlist — configure via API or env
    await scheduleRecurringJobs([
      { symbol: 'BTCUSDT', exchange: 'binance' },
      { symbol: 'ETHUSDT', exchange: 'binance' },
    ]);

    logger.info('Trading worker running. Press Ctrl+C to stop.');
  })();
}

module.exports = { tradingQueue, startWorker, addTradingJob, scheduleRecurringJobs, processTradingJob };
