'use strict';

const { getCapability } = require('../capability-registry');
const { assertPreparationRoutePosture, assertMaturityGateRoute } = require('../prompt-runtime/route-control');

const PPL_WORKFLOW_STAGES = Object.freeze([
  'Seed','Shape','Challenge','Repair','Reconcile','Candidate Development',
  'Independent Validation','Whole-Artifact Review','Final Revalidation','Handoff',
]);

function normalizeStage(stage) {
  const value = String(stage || '').trim();
  if (!PPL_WORKFLOW_STAGES.includes(value)) throw new TypeError(`Unknown PPL workflow stage: ${stage}`);
  return value;
}

function createPreparationWorkflowPlan({ profile, stages = [] } = {}) {
  if (!profile || typeof profile !== 'object') throw new TypeError('PPL workflow requires a Preparation Profile.');
  if (!Array.isArray(stages) || stages.length === 0) throw new TypeError('PPL workflow requires explicitly justified stages.');
  const seen = new Set();
  let priorIndex = -1;
  const planned = [];
  for (const stageInput of stages) {
    if (!stageInput || typeof stageInput !== 'object' || Array.isArray(stageInput)) throw new TypeError('PPL stage binding must be an object.');
    const stage = normalizeStage(stageInput.stage);
    const index = PPL_WORKFLOW_STAGES.indexOf(stage);
    if (index <= priorIndex || seen.has(stage)) throw new TypeError('PPL stages must be unique and follow canonical order.');
    seen.add(stage);
    priorIndex = index;

    const capability = getCapability(stageInput.capabilityId);
    const deterministic = capability.authority_ceiling === 'T0';
    const maturityTarget = stageInput.maturityTarget == null ? null : String(stageInput.maturityTarget);
    let routePosture = null;
    if (!deterministic) {
      routePosture = assertPreparationRoutePosture(stageInput.routePosture);
      if (maturityTarget) assertMaturityGateRoute({ targetMaturity: maturityTarget, routePosture });
    }
    planned.push(Object.freeze({
      stage,
      capabilityId: capability.id,
      deterministic,
      maturityTarget,
      routePosture,
      reviewPurpose: String(stageInput.reviewPurpose || stage).trim(),
      independent: stageInput.independent === true,
    }));
  }

  for (const required of profile.required_independent_review_stages || []) {
    const normalized = String(required).toLowerCase().replace(/_/g,' ');
    const match = planned.find((item) => item.stage.toLowerCase() === normalized);
    if (!match || match.independent !== true) {
      const error = new Error(`Preparation Profile requires independent stage: ${required}`);
      error.code = 'TEACHING_PPL_REQUIRED_INDEPENDENT_STAGE_MISSING';
      throw error;
    }
  }

  return Object.freeze({
    profileId: profile.profile_id,
    profileVersion: profile.version,
    stages: Object.freeze(planned),
    universalPassCount: null,
  });
}

async function executePreparationWorkflow(plan, {
  executeModelStage,
  executeDeterministicStage,
  initialArtifact = null,
} = {}) {
  if (!plan?.stages) throw new TypeError('Valid PPL workflow plan is required.');
  if (typeof executeModelStage !== 'function' || typeof executeDeterministicStage !== 'function') {
    throw new TypeError('PPL workflow execution requires model and deterministic stage executors.');
  }
  let lastValidArtifact = initialArtifact;
  const stageResults = [];
  for (const stage of plan.stages) {
    try {
      const result = stage.deterministic
        ? await executeDeterministicStage(stage, lastValidArtifact)
        : await executeModelStage(stage, lastValidArtifact);
      if (result?.artifact !== undefined && result?.valid !== false) lastValidArtifact = result.artifact;
      stageResults.push(Object.freeze({ stage: stage.stage, ok: true, result }));
    } catch (error) {
      return Object.freeze({
        completed: false,
        failedStage: stage.stage,
        failureCode: error?.code || 'TEACHING_PPL_STAGE_FAILED',
        lastValidArtifact,
        stageResults: Object.freeze(stageResults),
      });
    }
  }
  return Object.freeze({ completed: true, lastValidArtifact, stageResults: Object.freeze(stageResults) });
}

module.exports = { PPL_WORKFLOW_STAGES, createPreparationWorkflowPlan, executePreparationWorkflow };
