'use strict';

const { createAIOrchestrator } = require('./orchestrator');
const {
  createModelCatalog,
  createQualificationModelCatalog,
  GROQ_QUALIFICATION_MODEL_CATALOG,
  GROQ_MODEL_IDS,
  GROQ_TEXT_CAPABILITIES,
} = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const {
  createProjectPool,
  createGroqCredentialPool,
  createCloudflareCredentialPool,
} = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { createGoogleProviderAdapter } = require('./google-provider-adapter');
const { createGroqHttpTransport } = require('./groq-http-transport');
const {
  createGroqProviderAdapter,
  GROQ_QUOTA_POLICY,
  GROQ_SUPPORTED_REASONING,
} = require('./groq-provider-adapter');
const { normalizeGroqResponse } = require('./groq-response-normalizer');
const {
  GROQ_ERROR_CODES,
  classifyGroqHttpError,
  extractGroqEvidence,
} = require('./groq-error-classifier');
const {
  createIsolatedProviderExecutor,
  createGroqIsolatedExecutor,
} = require('./isolated-provider-executor');
const { createProviderRegistry } = require('./provider-registry');
const { AI_PROVIDERS } = require('./providers');
const {
  createExecutionRequest,
  createExecutionResponse,
} = require('./execution-contracts');
const {
  QUOTA_SCOPES,
  getProviderQuotaPolicy,
  credentialFailureAction,
  quotaScopeFromError,
} = require('./quota-policy');
const { normalizeGeminiResponse } = require('./response-normalizer');
const { createQuotaManager } = require('./quota-manager');
const { createTelemetry } = require('./telemetry');
const { createPostgresAIStore } = require('./postgres-store');
const { createModelLifecycle } = require('./model-lifecycle');
const { createModelQualifier } = require('./model-qualifier');
const { createModelDiscoveryManager } = require('./model-discovery');
const { createProviderHealth } = require('./provider-health');
const { createAITrafficController } = require('./traffic-controller');
const { createAIRuntime } = require('./runtime');

module.exports = {
  createAIOrchestrator,
  createModelCatalog,
  createQualificationModelCatalog,
  GROQ_QUALIFICATION_MODEL_CATALOG,
  GROQ_MODEL_IDS,
  GROQ_TEXT_CAPABILITIES,
  createModelRouter,
  createProjectPool,
  createGroqCredentialPool,
  createCloudflareCredentialPool,
  createGeminiTransport,
  createGoogleProviderAdapter,
  createGroqHttpTransport,
  createGroqProviderAdapter,
  GROQ_QUOTA_POLICY,
  GROQ_SUPPORTED_REASONING,
  normalizeGroqResponse,
  GROQ_ERROR_CODES,
  classifyGroqHttpError,
  extractGroqEvidence,
  createIsolatedProviderExecutor,
  createGroqIsolatedExecutor,
  createProviderRegistry,
  AI_PROVIDERS,
  createExecutionRequest,
  createExecutionResponse,
  QUOTA_SCOPES,
  getProviderQuotaPolicy,
  credentialFailureAction,
  quotaScopeFromError,
  normalizeGeminiResponse,
  createQuotaManager,
  createTelemetry,
  createPostgresAIStore,
  createModelLifecycle,
  createModelQualifier,
  createModelDiscoveryManager,
  createProviderHealth,
  createAITrafficController,
  createAIRuntime,
};
