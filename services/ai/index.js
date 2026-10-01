'use strict';

// Public KIWI AI architecture surface. Provider-native transports and retired
// migration runtimes are intentionally not re-exported from this module.

const capabilities = require('./capabilities');
const providers = require('./providers');
const modelCatalog = require('./model-catalog');
const routingPolicy = require('./routing-policy');
const taskRegistry = require('./task-registry');
const executionContracts = require('./execution-contracts');
const visualContracts = require('./visual-contracts');
const teacherVoices = require('./teacher-voices');
const errors = require('./errors');
const quotaPolicy = require('./quota-policy');

const { createCredentialRegistry } = require('./credential-registry');
const { createProviderRegistry } = require('./provider-registry');
const { createGoogleProviderAdapter } = require('./google-provider-adapter');
const { createGroqProviderAdapter } = require('./groq-provider-adapter');
const { createCloudflareProviderAdapter } = require('./cloudflare-provider-adapter');
const { createKrokiProviderAdapter } = require('./kroki-provider-adapter');
const { createModelRouter } = require('./model-router');
const { createModelLifecycle } = require('./model-lifecycle');
const { createModelDiscoveryManager } = require('./model-discovery');
const { createModelQualifier } = require('./model-qualifier');
const { createProviderHealth } = require('./provider-health');
const { createQuotaManager } = require('./quota-manager');
const { createAITrafficController } = require('./traffic-controller');
const { createRouteScheduler } = require('./route-scheduler');
const { createOperationBudget } = require('./operation-budget');
const { createTelemetry } = require('./telemetry');
const { createAIOrchestrator } = require('./orchestrator');
const { createCapabilityRuntime } = require('./capability-runtime');
const { createAIRuntime } = require('./runtime');

module.exports = {
  ...capabilities,
  ...providers,
  ...modelCatalog,
  ...routingPolicy,
  ...taskRegistry,
  ...executionContracts,
  ...visualContracts,
  ...teacherVoices,
  ...errors,
  ...quotaPolicy,
  createCredentialRegistry,
  createProviderRegistry,
  createGoogleProviderAdapter,
  createGroqProviderAdapter,
  createCloudflareProviderAdapter,
  createKrokiProviderAdapter,
  createModelRouter,
  createModelLifecycle,
  createModelDiscoveryManager,
  createModelQualifier,
  createProviderHealth,
  createQuotaManager,
  createAITrafficController,
  createRouteScheduler,
  createOperationBudget,
  createTelemetry,
  createAIOrchestrator,
  createCapabilityRuntime,
  createAIRuntime,
};
