/**
 * Database Connection Module
 * --------------------------
 * Manages MongoDB connection lifecycle using Mongoose.
 * Implements retry logic and graceful shutdown handling.
 */

const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Connect to MongoDB with retry logic.
 * Mongoose connection pool is shared across the application.
 */
async function connectDatabase(retryCount = 0) {
  try {
    await mongoose.connect(config.mongo.uri, {
      dbName: config.mongo.dbName,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info(`✅ MongoDB connected: ${config.mongo.uri}`);

    // Connection event handlers
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnection...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected successfully.');
    });

    return mongoose.connection;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn(
        `MongoDB connection failed (attempt ${retryCount + 1}/${MAX_RETRIES}). ` +
        `Retrying in ${RETRY_DELAY_MS / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return connectDatabase(retryCount + 1);
    }

    logger.error('❌ MongoDB connection failed after max retries:', error);
    throw error;
  }
}

/**
 * Gracefully close the database connection.
 */
async function disconnectDatabase() {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed gracefully.');
  } catch (error) {
    logger.error('Error closing MongoDB connection:', error);
  }
}

module.exports = { connectDatabase, disconnectDatabase };
