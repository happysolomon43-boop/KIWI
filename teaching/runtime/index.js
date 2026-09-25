'use strict';

const { createPostgresTeachingEventStore } = require('./postgres-event-store');
const { createDurableTeachingEventRuntime } = require('./durable-event-runtime');
const { createPostgresTeachingExecutionTelemetry } = require('../observability/postgres-execution-telemetry');
const { createCentralAIExecutionBoundary } = require('../ai/central-orchestrator-boundary');

function parseBounded(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function createTeachingRuntimePlatform({
  query,
  randomUUID,
  aiRun,
  env = process.env,
  logger = console,
  clock = () => new Date(),
  timers,
} = {}) {
  if (typeof query !== 'function') throw new TypeError('Teaching runtime requires query().');
  if (typeof randomUUID !== 'function') throw new TypeError('Teaching runtime requires randomUUID().');
  if (typeof aiRun !== 'function') throw new TypeError('Teaching runtime requires central aiRun().');

  const eventStore = createPostgresTeachingEventStore({ query, randomUUID });
  const executionTelemetry = createPostgresTeachingExecutionTelemetry({ query, randomUUID });
  const workerId = `teaching-runtime:${randomUUID()}`;
  const eventRuntime = createDurableTeachingEventRuntime({
    store: eventStore,
    workerId,
    logger,
    clock,
    timers,
    pollMs: parseBounded(env.TEACHING_RUNTIME_POLL_MS, 5_000, 1_000, 60_000),
    leaseMs: parseBounded(env.TEACHING_RUNTIME_LEASE_MS, 30_000, 5_000, 300_000),
    batchSize: parseBounded(env.TEACHING_RUNTIME_BATCH_SIZE, 20, 1, 100),
    maxAttempts: parseBounded(env.TEACHING_RUNTIME_MAX_ATTEMPTS, 5, 1, 20),
    retryBaseMs: parseBounded(env.TEACHING_RUNTIME_RETRY_BASE_MS, 5_000, 1_000, 300_000),
  });
  const aiBoundary = createCentralAIExecutionBoundary({
    aiRun,
    telemetry: executionTelemetry,
  });

  let ready = false;
  let lastInitializationError = null;

  async function initialize() {
    try {
      await eventStore.assertReady();
      await executionTelemetry.assertReady();
      ready = true;
      lastInitializationError = null;
      return true;
    } catch (error) {
      ready = false;
      lastInitializationError = {
        code: error?.code || null,
        message: error?.message || String(error),
      };
      throw error;
    }
  }

  function start() {
    if (!ready) {
      const error = new Error('Teaching durable runtime cannot start before schema readiness passes.');
      error.code = 'TEACHING_RUNTIME_NOT_READY';
      throw error;
    }
    return eventRuntime.start();
  }

  function stop() {
    return eventRuntime.stop();
  }

  function status() {
    return Object.freeze({
      ready,
      lastInitializationError,
      events: eventRuntime.status(),
    });
  }

  return Object.freeze({
    eventStore,
    eventRuntime,
    executionTelemetry,
    aiBoundary,
    initialize,
    start,
    stop,
    status,
  });
}

module.exports = {
  createTeachingRuntimePlatform,
};
