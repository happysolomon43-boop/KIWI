'use strict';

const { createAIOrchestrator } = require('./orchestrator');
const { createModelCatalog } = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const { createProjectPool } = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { normalizeGeminiResponse } = require('./response-normalizer');
const { createQuotaManager } = require('./quota-manager');
const { createTelemetry } = require('./telemetry');
const { createPostgresAIStore } = require('./postgres-store');
const { createAIRuntime } = require('./runtime');

module.exports = {
  createAIOrchestrator,
  createModelCatalog,
  createModelRouter,
  createProjectPool,
  createGeminiTransport,
  normalizeGeminiResponse,
  createQuotaManager,
  createTelemetry,
  createPostgresAIStore,
  createAIRuntime,
};
