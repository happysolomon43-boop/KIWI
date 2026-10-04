'use strict';
const { D29_CONTRACT_VERSION, D29_TASK_IDS } = require('./contracts');
const { FIXTURE_VERSION } = require('./fixtures');
const { validateEvidence, evaluateReadiness } = require('./evidence');
function createD29QaService({ repository } = {}) {
  if (!repository) throw new TypeError('D29 QA service requires repository.');
  const state = new Map();
  return Object.freeze({
    status() { return Object.freeze({ contractVersion:D29_CONTRACT_VERSION, taskCount:D29_TASK_IDS.length, academicTruthOwner:false, promptBytesChanged:false, tpf20Qualified:false, d30Started:false, productionReleaseAuthorized:false }); },
    async begin(input = {}) { const runId = await repository.beginRun({ ...input, contractVersion:D29_CONTRACT_VERSION, fixtureVersion:FIXTURE_VERSION }); state.set(runId,{ evidence:[], defects:[], metrics:{} }); return runId; },
    async record(runId, input) { if (!state.has(runId)) throw Object.assign(new Error('Unknown D29 run.'),{code:'TEACHING_D29_RUN_UNKNOWN'}); const evidence=validateEvidence(input); state.get(runId).evidence.push(evidence); await repository.recordEvidence(runId,evidence); return evidence; },
    async defect(runId, defect) { if (!state.has(runId)) throw Object.assign(new Error('Unknown D29 run.'),{code:'TEACHING_D29_RUN_UNKNOWN'}); state.get(runId).defects.push(defect); await repository.recordDefect(runId,defect); },
    setMetrics(runId, metrics) { if (!state.has(runId)) throw Object.assign(new Error('Unknown D29 run.'),{code:'TEACHING_D29_RUN_UNKNOWN'}); state.get(runId).metrics={...metrics}; },
    async complete(runId) { const run=state.get(runId); if (!run) throw Object.assign(new Error('Unknown D29 run.'),{code:'TEACHING_D29_RUN_UNKNOWN'}); const result=evaluateReadiness(run); await repository.completeRun(runId,result); return result; },
  });
}
module.exports = { createD29QaService };
