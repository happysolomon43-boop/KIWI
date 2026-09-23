'use strict';

const { createAIOrchestrator } = require('./orchestrator');
const { createModelCatalog } = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const { createProjectPool } = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { normalizeGeminiResponse } = require('./response-normalizer');
const { createQuotaManager } = require('./quota-manager');
const { createTransientModelHealth } = require('./transient-model-health');
const { createTelemetry } = require('./telemetry');
const { createPostgresAIStore } = require('./postgres-store');
const { createModelLifecycle } = require('./model-lifecycle');
const { createModelQualifier } = require('./model-qualifier');
const { createModelDiscoveryManager } = require('./model-discovery');
const { createAIRuntime } = require('./runtime');

module.exports = {
  createAIOrchestrator,
  createModelCatalog,
  createModelRouter,
  createProjectPool,
  createGeminiTransport,
  normalizeGeminiResponse,
  createQuotaManager,
  createTransientModelHealth,
  createTelemetry,
  createPostgresAIStore,
  createModelLifecycle,
  createModelQualifier,
  createModelDiscoveryManager,
  createAIRuntime,
};
