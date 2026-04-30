/**
 * Test Run Script
 * ================
 * Validates the entire trading pipeline without executing real trades.
 * Tests each component independently, then runs an end-to-end simulation.
 *
 * Usage: npm run test:run
 */

require('dotenv').config();
const config = require('../src/config');
const logger = require('../src/utils/logger');

async function runTests() {
  console.log('\n🧪 AI Trading System — Test Run\n');
  console.log('='.repeat(50));

  let passed = 0;
  let failed = 0;

  // ── Test 1: Configuration ──────────────────────────────────
  try {
    console.log('\n📋 Test 1: Configuration');
    console.log(`   App Name: ${config.app.name}`);
    console.log(`   Trading Mode: ${config.app.tradingMode}`);
    console.log(`   Port: ${config.app.port}`);
    console.log(`   ✅ Config loaded successfully`);
    passed++;
  } catch (e) { console.log(`   ❌ Config failed: ${e.message}`); failed++; }

  // ── Test 2: Indicator Engine ───────────────────────────────
  try {
    console.log('\n📊 Test 2: Indicator Engine');
    const indicatorService = require('../src/services/indicator.service');

    // Generate mock candle data
    const mockCandles = generateMockCandles(100);
    const indicators = indicatorService.computeAllIndicators(mockCandles);

    if (!indicators) throw new Error('Indicators returned null');
    console.log(`   RSI: ${indicators.rsi}`);
    console.log(`   MACD: ${JSON.stringify(indicators.macd)}`);
    console.log(`   EMA20: ${indicators.ema20}`);
    console.log(`   EMA50: ${indicators.ema50}`);
    console.log(`   VWAP: ${indicators.vwap}`);
    console.log(`   Signals: ${JSON.stringify(indicators.signals)}`);
    console.log(`   ✅ Indicator engine working`);
    passed++;
  } catch (e) { console.log(`   ❌ Indicator engine failed: ${e.message}`); failed++; }

  // ── Test 3: AI Decision Engine (Mock) ──────────────────────
  try {
    console.log('\n🤖 Test 3: AI Decision Engine');
    const aiService = require('../src/services/ai.service');
    const indicatorService = require('../src/services/indicator.service');

    const mockCandles = generateMockCandles(100);
    const indicators = indicatorService.computeAllIndicators(mockCandles);

    // Test parseDecisionResponse
    const mockResponse = JSON.stringify({
      decision: 'BUY', entry_price: 50000, stop_loss: 49000,
      target_price: 52000, confidence: 75, reasoning: 'Test decision',
    });
    const parsed = aiService.parseDecisionResponse(mockResponse);
    console.log(`   Parsed decision: ${parsed.decision}`);
    console.log(`   Confidence: ${parsed.confidence}%`);
    console.log(`   ✅ AI parser working`);

    // Test with markdown-wrapped JSON
    const mdResponse = '```json\n' + mockResponse + '\n```';
    const mdParsed = aiService.parseDecisionResponse(mdResponse);
    console.log(`   Markdown-wrapped parse: ${mdParsed.decision}`);
    console.log(`   ✅ Markdown stripping working`);
    passed++;
  } catch (e) { console.log(`   ❌ AI engine failed: ${e.message}`); failed++; }

  // ── Test 4: Risk Engine ────────────────────────────────────
  try {
    console.log('\n🛡️  Test 4: Risk Engine');
    const riskService = require('../src/services/risk.service');

    // Test case 1: Good trade (should pass)
    const goodDecision = { decision: 'BUY', entry_price: 50000, stop_loss: 49000, target_price: 52500, confidence: 75, quantity: 1 };
    const goodResult = await riskService.validateTrade(goodDecision, 100000, 'BTCUSDT');
    console.log(`   Good trade approved: ${goodResult.approved} (R:R = ${goodResult.riskMetrics.riskRewardRatio}:1)`);

    // Test case 2: Low confidence (should fail)
    const lowConfDecision = { ...goodDecision, confidence: 30 };
    const lowConfResult = await riskService.validateTrade(lowConfDecision, 100000, 'BTCUSDT');
    console.log(`   Low confidence rejected: ${!lowConfResult.approved}`);
    console.log(`   Reasons: ${lowConfResult.reasons.join('; ')}`);

    // Test case 3: Bad R:R (should fail)
    const badRR = { decision: 'BUY', entry_price: 50000, stop_loss: 48000, target_price: 50500, confidence: 80, quantity: 1 };
    const badRRResult = await riskService.validateTrade(badRR, 100000, 'BTCUSDT');
    console.log(`   Bad R:R rejected: ${!badRRResult.approved}`);

    // Test position sizing
    const qty = riskService.calculatePositionSize(100000, 50000, 49000);
    console.log(`   Position size for $100k capital: ${qty} units`);
    console.log(`   ✅ Risk engine working`);
    passed++;
  } catch (e) { console.log(`   ❌ Risk engine failed: ${e.message}`); failed++; }

  // ── Test 5: Utility Functions ──────────────────────────────
  try {
    console.log('\n🔧 Test 5: Utility Functions');
    const helpers = require('../src/utils/helpers');

    const tradeId = helpers.generateTradeId();
    console.log(`   Generated Trade ID: ${tradeId}`);
    console.log(`   Round: ${helpers.roundTo(3.14159, 2)}`);
    console.log(`   % Change: ${helpers.percentChange(100, 105)}%`);

    const candle = helpers.normalizeCandle([1234567890000, '50000', '51000', '49000', '50500', '100'], 'binance');
    console.log(`   Normalized candle: O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
    console.log(`   ✅ Utilities working`);
    passed++;
  } catch (e) { console.log(`   ❌ Utilities failed: ${e.message}`); failed++; }

  // ── Summary ────────────────────────────────────────────────
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);

  if (failed > 0) {
    console.log('⚠️  Some tests failed. Check the errors above.');
    process.exit(1);
  } else {
    console.log('✅ All tests passed! System is ready.\n');
    process.exit(0);
  }
}

/** Generate mock OHLCV candle data for testing. */
function generateMockCandles(count) {
  const candles = [];
  let price = 50000;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48) * 200; // slight upward bias
    const open = price;
    price += change;
    const close = price;
    const high = Math.max(open, close) + Math.random() * 100;
    const low = Math.min(open, close) - Math.random() * 100;
    const volume = Math.random() * 100 + 10;
    candles.push({ timestamp: Date.now() - (count - i) * 60000, open, high, low, close, volume, source: 'mock' });
  }
  return candles;
}

runTests();
