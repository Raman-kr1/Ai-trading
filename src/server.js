/**
 * Server Entry Point
 * ===================
 * Initializes database, starts Express server, and optionally starts the trading worker.
 * Handles graceful shutdown for all connections.
 */

const config = require('./config');
const app = require('./app');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { redisClient } = require('./config/redis');
const { startWorker } = require('./workers/tradingWorker');
const logger = require('./utils/logger');

async function startServer() {
  try {
    // Connect to MongoDB
    await connectDatabase();

    // Start Express server
    const server = app.listen(config.app.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║          AI TRADING SYSTEM v1.0.0                ║
╠══════════════════════════════════════════════════╣
║  Mode:       ${config.app.tradingMode.toUpperCase().padEnd(35)}║
║  Port:       ${String(config.app.port).padEnd(35)}║
║  Env:        ${config.app.env.padEnd(35)}║
║  Dashboard:  http://localhost:${config.app.port}/dashboard${' '.repeat(10)}║
║  API:        http://localhost:${config.app.port}/api${' '.repeat(16)}║
║  Health:     http://localhost:${config.app.port}/health${' '.repeat(13)}║
╚══════════════════════════════════════════════════╝
      `);
    });

    // Start the trading worker (in-process)
    let worker;
    try {
      worker = startWorker();
    } catch (err) {
      logger.warn('Trading worker failed to start (Redis may be down):', err.message);
    }

    // ── Graceful Shutdown ────────────────────────────────────
    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);

      server.close(() => logger.info('HTTP server closed.'));

      if (worker) {
        await worker.close();
        logger.info('Trading worker closed.');
      }

      await disconnectDatabase();
      await redisClient.quit();
      logger.info('All connections closed. Exiting.');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', { error: err.message, stack: err.stack });
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', { reason: String(reason) });
    });
  } catch (error) {
    logger.error('Server startup failed:', { error: error.message });
    process.exit(1);
  }
}

startServer();
