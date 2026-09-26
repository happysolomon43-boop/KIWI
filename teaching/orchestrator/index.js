'use strict';

const { createTeachingOrchestrator } = require('./teaching-orchestrator');
const { createTeachingAIAdapter } = require('./ai-adapter');
const { createCapabilityContextAssembler } = require('./context-assembly');
const { createOrchestratorPreflight } = require('./preflight');
const { createAuthoritativeOwnerRouter } = require('./owner-router');
const { createOrchestrationPlan, executeOrchestrationPlan } = require('./composition');
const contracts = require('./contracts');
const revalidation = require('./state-revalidation');

module.exports = {
  createTeachingOrchestrator,
  createTeachingAIAdapter,
  createCapabilityContextAssembler,
  createOrchestratorPreflight,
  createAuthoritativeOwnerRouter,
  createOrchestrationPlan,
  executeOrchestrationPlan,
  ...contracts,
  ...revalidation,
};
