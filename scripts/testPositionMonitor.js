/**
 * Smoke test for the Position Monitor.
 *
 * Inserts a synthetic OPEN trade whose stop-loss sits *above* the
 * current BTC price (for a SELL entry that's still safe) — wait, we
 * want it to TRIGGER. So we set the take-profit *below* the current
 * price for a BUY entry. That guarantees the very first incoming tick
 * crosses the threshold and the monitor must close the trade.
 *
 * Usage:
 *   node scripts/testPositionMonitor.js
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const config = require('../src/config');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const Trade = require('../src/models/trade.model');
const positionMonitor = require('../src/services/positionMonitor.service');
const { bus, emit: emitEvent } = require('../src/utils/eventBus');
const { generateTradeId } = require('../src/utils/helpers');

const SYMBOL = 'BTCUSDT';

async function main() {
  await connectDatabase();

  // Hard-code a synthetic price so we don't depend on testnet REST.
  const price = 70000;
  console.log(`[test] using mock ${SYMBOL} price: ${price}`);

  // BUY at slightly below current; target SLIGHTLY above current → next
  // upward tick should hit TP. Stop-loss far below to avoid that path.
  const tradeId = generateTradeId();
  const trade = await Trade.create({
    tradeId,
    symbol: SYMBOL,
    exchange: 'paper',
    side: 'BUY',
    type: 'MARKET',
    quantity: 0.001,
    entryPrice: price * 0.999,
    stopLoss: price * 0.95,
    targetPrice: price * 1.0001,  // ridiculously close → trigger fast
    status: 'OPEN',
    tradingMode: 'paper',
  });
  console.log(`[test] inserted OPEN trade ${tradeId}, target=${trade.targetPrice}`);

  // Listen for the exit event.
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: no exit in 90s')), 90_000);
    bus.once('position:exit', (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  // Start the monitor only — we will inject a price tick directly so
  // the test isn't dependent on Binance testnet WS connectivity.
  await positionMonitor.start();

  // Inject a synthetic upward tick that crosses the take-profit.
  setTimeout(() => {
    emitEvent('price', { symbol: SYMBOL, price: price * 1.001, timestamp: Date.now() });
  }, 200);

  console.log('[test] waiting for SL/TP exit event…');
  try {
    const payload = await exited;
    console.log('[test] ✅ position:exit received:', payload);
  } catch (err) {
    console.error('[test] ❌', err.message);
    process.exitCode = 1;
  } finally {
    await Trade.deleteOne({ tradeId });
    positionMonitor.stop();
    await disconnectDatabase();
    process.exit(process.exitCode || 0);
  }
}

main().catch((err) => {
  console.error('[test] fatal:', err);
  process.exit(1);
});
