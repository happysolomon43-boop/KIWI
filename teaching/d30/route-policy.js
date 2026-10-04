'use strict';

const { createAIOrchestrator, AI_TASKS } = require('../../services/ai');
const { getCapability, listCapabilities } = require('../capability-registry');
const { getFamilyDefinition } = require('./contracts');

const D30_ROUTE_POLICY_VERSION = 'teaching-d30-route-policy-v1.1';
const WEBSITE_DEFAULT_AI_TASK = 'QUICK_QUESTIONS';
const COURSE_PLAN_AI_TASK = 'FLASHCARD_GENERATION';
const COURSE_PLAN_FAMILY = 'TPF-03';

function centralTaskFor({ capabilityId = null, familyId = null } = {}) {
  const capability = capabilityId ? getCapability(capabilityId) : null;
  const resolvedFamily = familyId || capability?.prompt_family_id || null;
  if (resolvedFamily) getFamilyDefinition(resolvedFamily);
  const taskId = resolvedFamily === COURSE_PLAN_FAMILY ? COURSE_PLAN_AI_TASK : WEBSITE_DEFAULT_AI_TASK;
  if (!AI_TASKS[taskId]) throw new Error(`D30 central route task is not registered: ${taskId}`);
  return taskId;
}

function routePostureFor({ familyId, stage = null } = {}) {
  if (familyId === 'TPF-20') {
    if (stage === 'PRECLASS') return 'bounded_interpretive';
    if (stage === 'RECONCILIATION') return 'final_reconciliation';
    if (stage === 'END_TO_END') return 'final_reconciliation';
  }
  const family = getFamilyDefinition(familyId);
  if (family.criticality === 'C4') return 'strong_design';
  if (family.criticality === 'C3') return 'bounded_interpretive';
  return 'economy_maintenance';
}

function centrallyEligibleRouteKeys(orchestrator, taskId, routePosture) {
  if (!orchestrator?.router?.resolveCandidates) return null;
  const candidates = orchestrator.router.resolveCandidates(taskId, {
    content:'',
    preparationRoutePosture:routePosture,
  });
  return new Set(candidates.map((candidate) => candidate.routeKey));
}

function buildCandidateManifest(orchestrator, { capabilityId, familyId = null, stage = null } = {}) {
  if (!orchestrator?.plan) throw new TypeError('D30 candidate manifest requires central KIWI AI Orchestrator plan().');
  const capability = capabilityId ? getCapability(capabilityId) : null;
  const resolvedFamily = familyId || capability?.prompt_family_id;
  const taskId = centralTaskFor({ capabilityId, familyId: resolvedFamily });
  const routePosture = routePostureFor({ familyId:resolvedFamily, stage });
  const eligibleKeys = centrallyEligibleRouteKeys(orchestrator, taskId, routePosture);
  const plan = orchestrator.plan(taskId, { content: '' });
  const postureCandidates = eligibleKeys
    ? plan.candidates.filter((candidate) => eligibleKeys.has(candidate.routeKey))
    : plan.candidates;
  if (!postureCandidates.length) {
    const error = new Error(`No centrally classified ${routePosture} route exists for ${capability?.id || resolvedFamily}.`);
    error.code = 'TEACHING_D30_PREPARATION_ROUTE_UNAVAILABLE';
    throw error;
  }
  return Object.freeze({
    policyVersion: D30_ROUTE_POLICY_VERSION,
    capabilityId: capability?.id || null,
    familyId: resolvedFamily,
    stage,
    routePosture,
    centralTaskId: taskId,
    centralPostureFilterApplied:Boolean(eligibleKeys),
    candidates: Object.freeze(postureCandidates.map((candidate, index) => Object.freeze({
      routeKey: candidate.routeKey,
      provider: candidate.provider,
      modelId: candidate.modelId,
      role: index === 0 ? 'PRIMARY' : 'FALLBACK',
      reasoning: candidate.reasoning,
      taskClass: candidate.taskClass,
      temporarilyUnavailable: Boolean(candidate.temporarilyUnavailable),
      independentlyQualified: false,
    }))),
    routeConfigurationRaisesAuthority: false,
  });
}

function createPinnedQualificationOrchestrator(baseOrchestrator, routeKey) {
  if (!baseOrchestrator?.router?.resolveCandidates || !baseOrchestrator?.run) {
    throw new TypeError('Pinned qualification requires an initialized central KIWI AI Orchestrator.');
  }
  const baseRouter = baseOrchestrator.router;
  const pinnedRouter = Object.freeze({
    getTask: (taskId) => baseRouter.getTask(taskId),
    resolveCandidates(taskId, options = {}) {
      const candidates = baseRouter.resolveCandidates(taskId, options).filter((candidate) => candidate.routeKey === routeKey);
      if (!candidates.length) {
        const error = new Error(`Route ${routeKey} is not an approved candidate for ${taskId}.`);
        error.code = 'TEACHING_D30_ROUTE_NOT_APPROVED';
        throw error;
      }
      return Object.freeze(candidates);
    },
  });
  return createAIOrchestrator({
    registry: baseOrchestrator.registry,
    catalog: baseOrchestrator.catalog,
    router: pinnedRouter,
    providerRegistry: baseOrchestrator.providerRegistry,
    credentialRegistry: baseOrchestrator.credentialRegistry,
    quotaManager: baseOrchestrator.quotaManager,
    telemetry: baseOrchestrator.telemetry,
    modelLifecycle: baseOrchestrator.modelLifecycle,
    providerHealth: baseOrchestrator.providerHealth,
    trafficController: baseOrchestrator.trafficController,
    routeScheduler: baseOrchestrator.routeScheduler,
    operationBudget: baseOrchestrator.operationBudget,
  });
}

function enumerateModelEligibleTeachingCapabilities() {
  return Object.freeze(listCapabilities().filter((capability) => capability.authority_ceiling !== 'T0' && capability.prompt_family_id));
}

module.exports = {
  D30_ROUTE_POLICY_VERSION,
  WEBSITE_DEFAULT_AI_TASK,
  COURSE_PLAN_AI_TASK,
  COURSE_PLAN_FAMILY,
  centralTaskFor,
  routePostureFor,
  centrallyEligibleRouteKeys,
  buildCandidateManifest,
  createPinnedQualificationOrchestrator,
  enumerateModelEligibleTeachingCapabilities,
};