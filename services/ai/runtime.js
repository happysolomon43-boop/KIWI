'use strict';

const { AI_TASKS } = require('./task-registry');
const { createModelCatalog } = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const { createProjectPool } = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { createPostgresAIStore } = require('./postgres-store');
const { createQuotaManager } = require('./quota-manager');
const { createTelemetry } = require('./telemetry');
const { createAIOrchestrator } = require('./orchestrator');

function createAIRuntime({
  query,
  randomUUID,
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const store = createPostgresAIStore({ query, randomUUID });
  const catalog = createModelCatalog();
  const projectPool = createProjectPool({ env });
  const quotaManager = createQuotaManager({ store });
  const telemetry = createTelemetry({ store, logger });
  const router = createModelRouter({ registry: AI_TASKS, catalog });
  const transport = createGeminiTransport({ fetchImpl });

  const orchestrator = createAIOrchestrator({
    registry: AI_TASKS,
    catalog,
    router,
    projectPool,
    quotaManager,
    telemetry,
    transport,
    logger,
    env,
  });

  async function initialize() {
    // Persist the currently approved seed catalog. Discovery/promotion is added
    // later; this gives the database an operational source of truth now.
    await store.seedCatalog(catalog.list());
    const state = await orchestrator.initialize();

    if (typeof logger?.log === 'function') {
      logger.log(
        `[KIWI AI] orchestrator initialized: ${state.projectSlots} project slot(s), ` +
        `${state.hydratedProjectModelStates} persisted model-state record(s)`
      );
    }

    return state;
  }

  function observeLegacy(taskId, legacyModel = null) {
    // Shadow mode must never delay or break a user-facing legacy AI request.
    setImmediate(() => {
      orchestrator.observe(taskId, { legacyModel }).catch((error) => {
        if (typeof logger?.warn === 'function') {
          logger.warn('[KIWI AI] shadow observation failed', {
            taskId,
            error: error?.message || String(error),
          });
        }
      });
    });
  }

  return Object.freeze({
    store,
    catalog,
    projectPool,
    quotaManager,
    telemetry,
    orchestrator,
    initialize,
    observeLegacy,
  });
}

module.exports = {
  createAIRuntime,
};
