'use strict';

const { assertMaturityGateRoute } = require('../prompt-runtime/route-control');
const { assertProtectedPreparationAccess } = require('../security/d04-persistence-contract');

const PPL_T0_CAPABILITIES = Object.freeze({
  WORKSPACE_STATE_TRANSITION: 'teaching.preparation.workspace_state_transition',
  MATERIALITY_STALENESS_RECONCILIATION: 'teaching.preparation.materiality_staleness_reconciliation',
  FINALIZATION_READINESS_GATE: 'teaching.preparation.finalization_readiness_gate',
  PROTECTED_CONTENT_ISOLATION: 'teaching.preparation.protected_content_isolation',
});

const LIFECYCLE = Object.freeze(['ACTIVE','FINALIZATION_DUE','FINALIZED','HANDED_OFF','SUPERSEDED','CANCELLED']);
const MATURITY = Object.freeze(['SKELETON','STRUCTURED','CANDIDATE','PRE_LOCK_READY']);
const TERMINAL_LIFECYCLE = Object.freeze(new Set(['HANDED_OFF','SUPERSEDED','CANCELLED']));
const ALLOWED_LIFECYCLE_TRANSITIONS = Object.freeze({
  ACTIVE: Object.freeze(['ACTIVE','FINALIZATION_DUE','SUPERSEDED','CANCELLED']),
  FINALIZATION_DUE: Object.freeze(['FINALIZATION_DUE','FINALIZED','SUPERSEDED','CANCELLED']),
  FINALIZED: Object.freeze(['FINALIZED','HANDED_OFF','SUPERSEDED','CANCELLED']),
  HANDED_OFF: Object.freeze(['HANDED_OFF']),
  SUPERSEDED: Object.freeze(['SUPERSEDED']),
  CANCELLED: Object.freeze(['CANCELLED']),
});
const ALLOWED_MATURITY_TRANSITIONS = Object.freeze({
  SKELETON: Object.freeze(['SKELETON','STRUCTURED']),
  STRUCTURED: Object.freeze(['STRUCTURED','CANDIDATE']),
  CANDIDATE: Object.freeze(['CANDIDATE','PRE_LOCK_READY']),
  PRE_LOCK_READY: Object.freeze(['PRE_LOCK_READY']),
});

const ORDINARY_PROTECTED_CONTEXTS = Object.freeze(new Set([
  'teacher','lesson','homework','practice','broad_retrieval','student','student_facing','classroom',
]));
const ALLOWED_PROTECTED_CONTEXTS = Object.freeze(new Set([
  'protected_preparation','assessment_preparation','independent_validation',
  'final_reconciliation','assessment_owner_lock','protected_repair',
]));
const ALLOWED_PROTECTED_PURPOSES = Object.freeze(new Set([
  'preparation','independent_validation','final_reconciliation','assessment_owner_lock','protected_repair',
]));
const UNPROTECTED_CLASSES = Object.freeze(new Set(['NONE','PUBLIC','UNPROTECTED']));

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizeLifecycle(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g,'_');
  if (!LIFECYCLE.includes(normalized)) fail(`Unsupported PPL lifecycle state: ${value}`, 'TEACHING_PPL_LIFECYCLE_INVALID');
  return normalized;
}

function normalizeMaturity(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[ -]+/g,'_');
  if (!MATURITY.includes(normalized)) fail(`Unsupported PPL maturity: ${value}`, 'TEACHING_PPL_MATURITY_INVALID');
  return normalized;
}

function normalizeChecks(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${field}[${index}] must be an object.`);
    return Object.freeze({
      id: String(item.id || `${field}:${index}`),
      passed: item.passed === true,
      reason: item.reason == null ? null : String(item.reason),
    });
  });
}

function evaluateFinalizationReadiness({
  versions = [],
  requiredValidations = [],
  openFindings = [],
  protectionChecks = [],
  policyChecks = [],
  feasibilityChecks = [],
  ownerPreconditions = [],
  deadlineAt = null,
} = {}) {
  const blockers = [];
  for (const version of versions || []) {
    if (!version || String(version.expected ?? '') !== String(version.current ?? '')) {
      blockers.push(`VERSION_CHANGED:${version?.id || 'unknown'}`);
    }
  }
  for (const check of [
    ...normalizeChecks(requiredValidations,'requiredValidations'),
    ...normalizeChecks(protectionChecks,'protectionChecks'),
    ...normalizeChecks(policyChecks,'policyChecks'),
    ...normalizeChecks(feasibilityChecks,'feasibilityChecks'),
    ...normalizeChecks(ownerPreconditions,'ownerPreconditions'),
  ]) {
    if (!check.passed) blockers.push(check.reason || `CHECK_FAILED:${check.id}`);
  }
  for (const finding of openFindings || []) {
    if (finding?.blocksFinalization === true && String(finding.status || 'OPEN').toUpperCase() !== 'RESOLVED') {
      blockers.push(`OPEN_BLOCKING_FINDING:${finding.id || 'unknown'}`);
    }
  }
  return Object.freeze({
    ready: blockers.length === 0,
    disposition: blockers.length === 0 ? 'READY' : 'NOT_READY',
    blockers: Object.freeze(blockers),
    deadline_at: deadlineAt == null ? null : String(deadlineAt),
    deadline_override_allowed: false,
  });
}

function evaluateWorkspaceTransition({
  currentLifecycle,
  currentMaturity,
  nextLifecycle = null,
  nextMaturity = null,
  gateResults = [],
  routePosture = null,
  finalizationReadiness = null,
} = {}) {
  const currentL = normalizeLifecycle(currentLifecycle);
  const currentM = normalizeMaturity(currentMaturity);
  const nextL = nextLifecycle == null ? currentL : normalizeLifecycle(nextLifecycle);
  const nextM = nextMaturity == null ? currentM : normalizeMaturity(nextMaturity);

  if (TERMINAL_LIFECYCLE.has(currentL) && nextL !== currentL) {
    fail('Terminal Preparation Workspace lifecycle states cannot be reopened.', 'TEACHING_PPL_TERMINAL_REOPEN_FORBIDDEN');
  }
  if (!ALLOWED_LIFECYCLE_TRANSITIONS[currentL].includes(nextL)) {
    fail(`Illegal PPL lifecycle transition ${currentL} -> ${nextL}.`, 'TEACHING_PPL_LIFECYCLE_TRANSITION_FORBIDDEN');
  }
  if (MATURITY.indexOf(nextM) < MATURITY.indexOf(currentM)) {
    fail(`PPL maturity cannot move backwards ${currentM} -> ${nextM}.`, 'TEACHING_PPL_MATURITY_REGRESSION_FORBIDDEN');
  }
  if (!ALLOWED_MATURITY_TRANSITIONS[currentM].includes(nextM)) {
    fail(
      `Illegal PPL maturity transition ${currentM} -> ${nextM}; maturity must advance through the canonical gates.`,
      'TEACHING_PPL_MATURITY_TRANSITION_FORBIDDEN'
    );
  }

  const checks = normalizeChecks(gateResults,'gateResults');
  if (nextL !== currentL || nextM !== currentM) {
    const failed = checks.find((check) => !check.passed);
    if (failed) fail(failed.reason || `Required transition gate failed: ${failed.id}`, 'TEACHING_PPL_TRANSITION_GATE_FAILED');
  }

  if (nextM === 'PRE_LOCK_READY' && nextM !== currentM) {
    if (!routePosture) fail('Pre-Lock Ready requires a route posture.', 'TEACHING_PPL_ROUTE_REQUIRED');
    assertMaturityGateRoute({ targetMaturity: 'Pre-Lock Ready', routePosture });
    if (!finalizationReadiness?.ready) {
      fail('Pre-Lock Ready requires a passing current-state finalization gate.', 'TEACHING_PPL_FINALIZATION_NOT_READY');
    }
  }

  if (['FINALIZED','HANDED_OFF'].includes(nextL) && nextL !== currentL && !finalizationReadiness?.ready) {
    fail('Finalization/handoff requires a passing current-state finalization gate.', 'TEACHING_PPL_FINALIZATION_NOT_READY');
  }

  return Object.freeze({
    allowed: true,
    nextLifecycle: nextL,
    nextMaturity: nextM,
    authoritative: true,
    modelConfidenceUsed: false,
  });
}

function reconcileMaterialityAndStaleness({
  completionCapturedVersions = null,
  currentVersions = {},
  changedDependencyRefs = [],
  componentDependencies = [],
  allComponentIds = [],
} = {}) {
  if (completionCapturedVersions && typeof completionCapturedVersions === 'object') {
    const versionKeys = new Set([
      ...Object.keys(completionCapturedVersions || {}),
      ...Object.keys(currentVersions || {}),
    ]);
    const changedVersions = [...versionKeys].filter(
      (key) => String(completionCapturedVersions?.[key] ?? '') !== String(currentVersions?.[key] ?? '')
    );
    if (changedVersions.length) {
      return Object.freeze({
        disposition: 'STALE_RESULT_REJECTED',
        stale: true,
        material: false,
        changedVersions: Object.freeze(changedVersions.sort()),
        invalidatedComponentIds: Object.freeze([]),
      });
    }
  }

  const changed = new Set((changedDependencyRefs || []).map(String));
  if (changed.size === 0) {
    return Object.freeze({
      disposition: 'NON_MATERIAL_NOOP',
      stale: false,
      material: false,
      changedVersions: Object.freeze([]),
      invalidatedComponentIds: Object.freeze([]),
    });
  }

  const componentIds = new Set();
  const mappedChangedRefs = new Set();
  const allComponents = new Set((allComponentIds || []).map(String).filter(Boolean));
  for (const edge of componentDependencies || []) {
    const componentId = String(edge.componentId || '').trim();
    const dependencyRef = String(edge.dependencyRef || '').trim();
    if (!componentId || !dependencyRef) continue;
    allComponents.add(componentId);
    if (changed.has(dependencyRef) || changed.has('*')) {
      componentIds.add(componentId);
      mappedChangedRefs.add(dependencyRef);
    }
  }

  // A material trigger cannot be downgraded to NON_MATERIAL merely because
  // the dependency/component map is incomplete. If D04 lineage cannot prove
  // selective invalidation is safe, fail closed by invalidating the whole
  // current artifact rather than trusting potentially stale preparation.
  const hasUnmappedChange = changed.has('*') ||
    [...changed].some((ref) => !mappedChangedRefs.has(ref));
  if (hasUnmappedChange) {
    return Object.freeze({
      disposition: 'MATERIAL_FULL_INVALIDATION',
      stale: false,
      material: true,
      changedVersions: Object.freeze([]),
      invalidatedComponentIds: Object.freeze([...allComponents].sort()),
      fullArtifactInvalidation: true,
      artifactValidity: 'STALE',
    });
  }

  if (componentIds.size === 0) {
    return Object.freeze({
      disposition: 'NON_MATERIAL_NOOP',
      stale: false,
      material: false,
      changedVersions: Object.freeze([]),
      invalidatedComponentIds: Object.freeze([]),
      fullArtifactInvalidation: false,
    });
  }

  return Object.freeze({
    disposition: 'MATERIAL_INVALIDATION',
    stale: false,
    material: true,
    changedVersions: Object.freeze([]),
    invalidatedComponentIds: Object.freeze([...componentIds].sort()),
    fullArtifactInvalidation: componentIds.size === allComponents.size,
    artifactValidity: componentIds.size === allComponents.size ? 'STALE' : 'PARTIALLY_STALE',
  });
}

function assertProtectedContentIsolation({
  protectionClass,
  contextKind,
  accessPurpose,
  authorization = {},
} = {}) {
  const protection = String(protectionClass || '').trim().toUpperCase();
  if (!protection) throw new TypeError('protectionClass is required.');
  const context = String(contextKind || '').trim().toLowerCase();
  const purpose = String(accessPurpose || '').trim().toLowerCase();
  if (UNPROTECTED_CLASSES.has(protection)) return true;
  if (ORDINARY_PROTECTED_CONTEXTS.has(context)) {
    fail(`Protected preparation content cannot enter ${context} context.`, 'TEACHING_PPL_PROTECTED_CONTEXT_DENIED');
  }
  if (!ALLOWED_PROTECTED_CONTEXTS.has(context)) {
    fail(
      `Protected preparation content requires an explicitly authorized protected context: ${context || 'missing'}.`,
      'TEACHING_PPL_PROTECTED_CONTEXT_DENIED'
    );
  }
  if (!ALLOWED_PROTECTED_PURPOSES.has(purpose)) {
    fail(`Protected preparation access purpose is not authorized: ${purpose}`, 'TEACHING_PPL_PROTECTED_PURPOSE_DENIED');
  }
  assertProtectedPreparationAccess(authorization);
  return true;
}

function requireRepository(repository) {
  const methods = ['getWorkspaceSnapshot','getFinalizationSnapshot','getMaterialitySnapshot','applyWorkspaceTransition','applyMaterialityDecision','auditNoop'];
  for (const method of methods) {
    if (typeof repository?.[method] !== 'function') throw new TypeError(`Preparation T0 runtime requires repository.${method}().`);
  }
}

function createPreparationT0Handlers({
  repository,
  currentVersionReader,
  transitionGateEvaluator = async () => [],
  finalizationCheckProvider,
} = {}) {
  requireRepository(repository);
  if (typeof currentVersionReader !== 'function') throw new TypeError('Preparation T0 runtime requires currentVersionReader().');
  if (typeof transitionGateEvaluator !== 'function') throw new TypeError('Preparation T0 runtime requires transitionGateEvaluator().');
  if (typeof finalizationCheckProvider !== 'function') throw new TypeError('Preparation T0 runtime requires finalizationCheckProvider().');

  async function currentFinalizationReadiness(workspaceId) {
    const snapshot = await repository.getFinalizationSnapshot(workspaceId);
    if (!snapshot?.workspace) fail(`Preparation Workspace not found: ${workspaceId}`, 'TEACHING_PPL_WORKSPACE_NOT_FOUND');
    const versions = [];
    for (const dependency of snapshot.dependencies || []) {
      const current = await currentVersionReader(dependency, snapshot);
      versions.push(Object.freeze({ id: dependency.aggregate_ref, expected: dependency.version_ref, current }));
    }
    const external = await finalizationCheckProvider(snapshot);
    if (!external || typeof external !== 'object' || Array.isArray(external)) {
      fail('Finalization check provider returned no deterministic check bundle.', 'TEACHING_PPL_FINALIZATION_CHECKS_MISSING');
    }
    const openFindings = (snapshot.findings || []).filter((finding) => String(finding.status || '').toUpperCase() === 'OPEN').map((finding) => Object.freeze({id:finding.finding_id||finding.id,status:finding.status,blocksFinalization:true}));
    const protectionChecks = [...(external.protectionChecks || []),Object.freeze({id:'artifact_not_contaminated',passed:snapshot.artifact==null||snapshot.artifact.validity_state!=='RETIRED_CONTAMINATED',reason:'PROTECTED_ARTIFACT_CONTAMINATED'})];
    const baseValidations = [
      Object.freeze({id:'current_authoritative_input_bundle_present',passed:Boolean(snapshot.workspace.current_authoritative_input_bundle_ref&&snapshot.bundle),reason:'CURRENT_AUTHORITATIVE_INPUT_BUNDLE_MISSING'}),
      Object.freeze({id:'current_artifact_present',passed:Boolean(snapshot.workspace.current_artifact_version_ref&&snapshot.artifact),reason:'CURRENT_PREPARED_ARTIFACT_MISSING'}),
      Object.freeze({id:'artifact_current',passed:snapshot.artifact?.validity_state==='CURRENT',reason:'CURRENT_PREPARED_ARTIFACT_NOT_CURRENT'}),
    ];
    return evaluateFinalizationReadiness({versions,requiredValidations:[...baseValidations,...(external.requiredValidations||[])],openFindings,protectionChecks,policyChecks:external.policyChecks||[],feasibilityChecks:external.feasibilityChecks||[],ownerPreconditions:external.ownerPreconditions||[],deadlineAt:snapshot.workspace.finalization_or_freeze_at});
  }

  return Object.freeze({
    [PPL_T0_CAPABILITIES.WORKSPACE_STATE_TRANSITION]: async ({ input }) => {
      const workspaceId=String(input?.workspaceId||'').trim();if(!workspaceId)throw new TypeError('workspaceId is required.');
      const snapshot=await repository.getWorkspaceSnapshot(workspaceId);if(!snapshot?.workspace)fail(`Preparation Workspace not found: ${workspaceId}`,'TEACHING_PPL_WORKSPACE_NOT_FOUND');
      const workspace=snapshot.workspace;
      const nextLifecycle=input.nextLifecycle==null?workspace.lifecycle_state:input.nextLifecycle;
      const nextMaturity=input.nextMaturity==null?workspace.maturity_stage:input.nextMaturity;
      const needsFinalizationGate=normalizeMaturity(nextMaturity)==='PRE_LOCK_READY'||['FINALIZED','HANDED_OFF'].includes(normalizeLifecycle(nextLifecycle));
      const finalizationReadiness=needsFinalizationGate?await currentFinalizationReadiness(workspaceId):null;
      const gateResults=await transitionGateEvaluator({workspace:snapshot,input});
      const decision=evaluateWorkspaceTransition({currentLifecycle:workspace.lifecycle_state,currentMaturity:workspace.maturity_stage,nextLifecycle,nextMaturity,gateResults,routePosture:input.routePosture,finalizationReadiness});
      const committed=await repository.applyWorkspaceTransition({workspaceId,expectedStateVersion:workspace.state_version,decision,correlationId:input.correlationId||null,causationId:input.causationId||null,reason:input.reason||null});
      return Object.freeze({...committed,authoritativeMutationPerformed:true});
    },
    [PPL_T0_CAPABILITIES.MATERIALITY_STALENESS_RECONCILIATION]: async ({ input }) => {
      const workspaceId=String(input?.workspaceId||'').trim();if(!workspaceId)throw new TypeError('workspaceId is required.');
      const snapshot=await repository.getMaterialitySnapshot(workspaceId);if(!snapshot?.workspace)fail(`Preparation Workspace not found: ${workspaceId}`,'TEACHING_PPL_WORKSPACE_NOT_FOUND');
      const currentVersions={};const changedRefs=new Set((input.changedDependencyRefs||[]).map(String));
      for(const dependency of snapshot.dependencies||[]){const current=await currentVersionReader(dependency,snapshot);currentVersions[dependency.aggregate_ref]=current;if(String(current??'')!==String(dependency.version_ref??''))changedRefs.add(String(dependency.aggregate_ref));}
      const decision=reconcileMaterialityAndStaleness({completionCapturedVersions:input.completionCapturedVersions||null,currentVersions,changedDependencyRefs:[...changedRefs],componentDependencies:snapshot.componentDependencies||[],allComponentIds:snapshot.componentIds||[]});
      if(decision.stale||!decision.material){await repository.auditNoop({workspaceId,action:decision.stale?'preparation.stale_result.reject':'preparation.materiality.noop',reason:decision.disposition,correlationId:input.correlationId||null,causationId:input.causationId||null,safeMetadata:{changed_versions:decision.changedVersions,changed_dependency_refs:[...changedRefs].sort()}});return decision;}
      const committed=await repository.applyMaterialityDecision({workspaceId,artifactVersionId:snapshot.workspace.current_artifact_version_ref,expectedStateVersion:snapshot.workspace.state_version,decision,correlationId:input.correlationId||null,causationId:input.causationId||null});
      return Object.freeze({...committed,authoritativeMutationPerformed:true});
    },
    [PPL_T0_CAPABILITIES.FINALIZATION_READINESS_GATE]: async ({ input }) => {const workspaceId=String(input?.workspaceId||'').trim();if(!workspaceId)throw new TypeError('workspaceId is required.');return currentFinalizationReadiness(workspaceId);},
    [PPL_T0_CAPABILITIES.PROTECTED_CONTENT_ISOLATION]: async ({ input }) => ({allowed:assertProtectedContentIsolation(input)}),
  });
}

module.exports = {PPL_T0_CAPABILITIES,LIFECYCLE,MATURITY,evaluateWorkspaceTransition,reconcileMaterialityAndStaleness,evaluateFinalizationReadiness,assertProtectedContentIsolation,createPreparationT0Handlers};
