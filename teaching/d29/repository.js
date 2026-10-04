'use strict';
function createD29Repository({ query, randomUUID = require('node:crypto').randomUUID } = {}) {
  if (typeof query !== 'function') throw new TypeError('D29 repository requires a query function.');
  return Object.freeze({
    async assertReady() { await query('select 1 from teaching_runtime.d29_qa_runs limit 0'); return true; },
    async beginRun(input) {
      const id = input.runId || randomUUID();
      await query(`insert into teaching_runtime.d29_qa_runs (id,contract_version,source_sha,fixture_version,environment,status,metadata) values ($1,$2,$3,$4,$5,'RUNNING',$6::jsonb)`, [id,input.contractVersion,input.sourceSha,input.fixtureVersion,input.environment,JSON.stringify(input.metadata || {})]);
      return id;
    },
    async recordEvidence(runId, evidence) {
      await query(`insert into teaching_runtime.d29_qa_evidence (run_id,scenario_id,task_ids,invariant_ids,result,reason_code,evidence) values ($1,$2,$3::text[],$4::text[],$5,$6,$7::jsonb) on conflict (run_id,scenario_id) do update set task_ids=excluded.task_ids,invariant_ids=excluded.invariant_ids,result=excluded.result,reason_code=excluded.reason_code,evidence=excluded.evidence,updated_at=now()`, [runId,evidence.scenarioId,evidence.taskIds,evidence.invariantIds,evidence.result,evidence.reasonCode || null,JSON.stringify(evidence)]);
    },
    async recordDefect(runId, defect) {
      await query(`insert into teaching_runtime.d29_qa_defects (run_id,defect_key,severity,title,details,resolved) values ($1,$2,$3,$4,$5::jsonb,$6) on conflict (run_id,defect_key) do update set severity=excluded.severity,title=excluded.title,details=excluded.details,resolved=excluded.resolved,updated_at=now()`, [runId,defect.key,defect.severity,defect.title,JSON.stringify(defect.details || {}),defect.resolved === true]);
    },
    async completeRun(runId, result) {
      await query(`update teaching_runtime.d29_qa_runs set status=$2,summary=$3::jsonb,completed_at=now() where id=$1`, [runId,result.accepted ? 'PASSED' : 'FAILED',JSON.stringify(result)]);
    },
  });
}
module.exports = { createD29Repository };
