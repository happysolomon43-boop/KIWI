'use strict';

const crypto = require('node:crypto');
const { assertNoHiddenChainOfThought, D30_CONTRACT_VERSION, EVALUATION_SUITE_VERSION, PROMPT_MANIFEST_VERSION, PROMPT_MANIFEST_SHA256 } = require('./contracts');
const { sanitizeOutputArtifact } = require('./evidence');

function json(value) { assertNoHiddenChainOfThought(value); return JSON.stringify(value ?? {}); }
function key(value) { return value == null ? '' : String(value); }
function runKey({ caseId, routeKey, routeRole, capabilityId = '', attemptNo = 1 } = {}) {
  return [caseId,routeKey,routeRole,key(capabilityId),Number(attemptNo)].join('::');
}
function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}
function mapCaseResult(row = {}) {
  return Object.freeze({
    runId:String(row.id), sessionId:String(row.session_id), caseId:String(row.case_id), familyId:String(row.family_id),
    capabilityId:row.capability_id ? String(row.capability_id) : null, routeKey:String(row.route_key), routeRole:String(row.route_role),
    routePosture:row.route_posture ? String(row.route_posture) : null, modelId:String(row.model_id), provider:String(row.provider),
    centralTaskId:row.central_task_id ? String(row.central_task_id) : null, modelSettingsHash:String(row.model_settings_hash),
    promptFamilyVersion:String(row.prompt_family_version), promptSha256:String(row.prompt_sha256), outputSchemaId:row.output_schema_id ? String(row.output_schema_id) : null,
    outputSchemaVersion:row.output_schema_version ? String(row.output_schema_version) : null, runKind:String(row.run_kind), criticality:String(row.criticality),
    attemptNo:Number(row.attempt_no), validation:parseJson(row.validation,{}), semanticReview:parseJson(row.semantic_review,null),
    outputArtifact:parseJson(row.output_artifact,null), latencyMs:Number(row.latency_ms || 0), inputTokens:Number(row.input_tokens || 0),
    outputTokens:Number(row.output_tokens || 0), estimatedCostUsd:Number(row.estimated_cost_usd || 0), retryCount:Number(row.retry_count || 0),
    timedOut:Boolean(row.timed_out), fallbackUsed:Boolean(row.fallback_used), defects:parseJson(row.defects,[]), executionMetadata:parseJson(row.execution_metadata,{}),
    createdAt:row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  });
}
function mapHumanReview(row = {}) {
  return Object.freeze({
    id:String(row.id), sessionId:String(row.session_id), runId:String(row.run_id), attemptNo:Number(row.attempt_no),
    caseId:String(row.case_id || ''), familyId:String(row.family_id), capabilityId:row.capability_id ? String(row.capability_id) : null,
    routeKey:String(row.route_key), reviewerRef:String(row.reviewer_ref), reviewerKind:String(row.reviewer_kind),
    independent:Boolean(row.independent), decision:String(row.decision), rubric:parseJson(row.rubric,{}),
    createdAt:row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  });
}

function createD30Repository({ query, randomUUID = crypto.randomUUID } = {}) {
  if (typeof query !== 'function') throw new TypeError('D30 repository requires a query function.');
  return Object.freeze({
    async assertReady() {
      await query('select 1 from teaching_runtime.d30_qualification_sessions limit 0');
      await query('select run_id,attempt_no from teaching_runtime.d30_human_reviews limit 0');
      await query('select 1 from teaching_runtime.d30_case_results limit 0');
      return true;
    },
    async beginSession({ sessionId = randomUUID(), sourceSha, environment = 'INTEGRATION', metadata = {} } = {}) {
      if (!String(sourceSha || '').match(/^[0-9a-f]{40}$/)) throw new Error('D30 session sourceSha must be a Git commit SHA.');
      await query(`insert into teaching_runtime.d30_qualification_sessions
        (id,contract_version,evaluation_suite_version,prompt_manifest_version,prompt_manifest_sha256,source_sha,environment,status,metadata)
        values ($1,$2,$3,$4,$5,$6,$7,'RUNNING',$8::jsonb)`,
      [sessionId,D30_CONTRACT_VERSION,EVALUATION_SUITE_VERSION,PROMPT_MANIFEST_VERSION,PROMPT_MANIFEST_SHA256,sourceSha,environment,json(metadata)]);
      return sessionId;
    },
    async findResumableSession({ sourceSha, environment = 'INTEGRATION' } = {}) {
      if (!String(sourceSha || '').match(/^[0-9a-f]{40}$/)) throw new Error('D30 resumable session lookup requires sourceSha.');
      const result = await query(`select * from teaching_runtime.d30_qualification_sessions
        where source_sha=$1 and environment=$2 and status='RUNNING'
        order by created_at desc limit 1`,[sourceSha,environment]);
      return result.rows?.[0] || null;
    },
    async getSession(sessionId) {
      const result = await query('select * from teaching_runtime.d30_qualification_sessions where id=$1',[sessionId]);
      return result.rows?.[0] || null;
    },
    async listCompletedRunKeys(sessionId) {
      const result = await query(`select case_id,route_key,route_role,capability_id,attempt_no
        from teaching_runtime.d30_case_results where session_id=$1`,[sessionId]);
      return new Set((result.rows || []).map((row) => runKey({
        caseId:row.case_id,routeKey:row.route_key,routeRole:row.route_role,capabilityId:row.capability_id,attemptNo:row.attempt_no,
      })));
    },
    async listCaseResults(sessionId, { familyId = null, capabilityId = null, routeKey = null, routeRole = null } = {}) {
      const result = await query(`select * from teaching_runtime.d30_case_results
        where session_id=$1
          and ($2::text is null or family_id=$2)
          and ($3::text is null or capability_id=$3)
          and ($4::text is null or route_key=$4)
          and ($5::text is null or route_role=$5)
        order by created_at,case_id,attempt_no`,[sessionId,familyId,capabilityId,routeKey,routeRole]);
      return Object.freeze((result.rows || []).map(mapCaseResult));
    },
    async listHumanReviews(sessionId) {
      const result = await query('select * from teaching_runtime.d30_human_reviews where session_id=$1 order by created_at',[sessionId]);
      return Object.freeze((result.rows || []).map(mapHumanReview));
    },
    async listPplComparisons(sessionId) {
      const result = await query('select * from teaching_runtime.d30_ppl_comparisons where session_id=$1 order by comparison_key',[sessionId]);
      return Object.freeze((result.rows || []).map((row) => Object.freeze({
        id:String(row.id), sessionId:String(row.session_id), comparisonKey:String(row.comparison_key),
        oneShotSummary:parseJson(row.one_shot_summary,{}), progressiveSummary:parseJson(row.progressive_summary,{}),
        decision:String(row.decision), evidence:parseJson(row.evidence,{}),
      })));
    },
    async sessionEvidenceCounts(sessionId) {
      const result = await query(`select
        (select count(*)::int from teaching_runtime.d30_case_results where session_id=$1) as case_results,
        (select count(*)::int from teaching_runtime.d30_human_reviews where session_id=$1) as human_reviews,
        (select count(*)::int from teaching_runtime.d30_defects where session_id=$1 and resolved=false) as open_defects,
        (select count(*)::int from teaching_runtime.d30_route_decisions where session_id=$1) as route_decisions,
        (select count(*)::int from teaching_runtime.d30_ppl_comparisons where session_id=$1) as ppl_comparisons`,[sessionId]);
      const row=result.rows?.[0] || {};
      return Object.freeze({
        caseResults:Number(row.case_results || 0), humanReviews:Number(row.human_reviews || 0), openDefects:Number(row.open_defects || 0),
        routeDecisions:Number(row.route_decisions || 0), pplComparisons:Number(row.ppl_comparisons || 0),
      });
    },
    async recordCaseResult(record) {
      assertNoHiddenChainOfThought(record);
      const outputArtifact = record.outputArtifact == null ? null : sanitizeOutputArtifact(record.outputArtifact);
      await query(`insert into teaching_runtime.d30_case_results
        (id,session_id,case_id,family_id,capability_id,route_key,route_role,route_posture,model_id,provider,central_task_id,model_settings_hash,
         prompt_family_version,prompt_sha256,output_schema_id,output_schema_version,run_kind,criticality,attempt_no,validation,semantic_review,output_artifact,
         latency_ms,input_tokens,output_tokens,estimated_cost_usd,retry_count,timed_out,fallback_used,defects,execution_metadata,created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22::jsonb,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb,$32)
        on conflict (session_id,case_id,route_key,route_role,capability_id,attempt_no)
        do update set validation=excluded.validation,semantic_review=excluded.semantic_review,output_artifact=excluded.output_artifact,latency_ms=excluded.latency_ms,input_tokens=excluded.input_tokens,
          output_tokens=excluded.output_tokens,estimated_cost_usd=excluded.estimated_cost_usd,retry_count=excluded.retry_count,timed_out=excluded.timed_out,
          fallback_used=excluded.fallback_used,defects=excluded.defects,execution_metadata=excluded.execution_metadata,created_at=excluded.created_at`,
      [record.runId,record.sessionId,record.caseId,record.familyId,key(record.capabilityId),record.routeKey,record.routeRole,key(record.routePosture),record.modelId,record.provider,
       key(record.centralTaskId),record.modelSettingsHash,record.promptFamilyVersion,record.promptSha256,key(record.outputSchemaId),key(record.outputSchemaVersion),record.runKind,record.criticality,
       record.attemptNo,json(record.validation),record.semanticReview==null?null:json(record.semanticReview),outputArtifact==null?null:json(outputArtifact),record.latencyMs,record.inputTokens,
       record.outputTokens,record.estimatedCostUsd,record.retryCount,record.timedOut,record.fallbackUsed,json(record.defects),json(record.executionMetadata),record.createdAt]);
    },
    async recordHumanReview({ id = randomUUID(), sessionId, runId, attemptNo, caseId = '', familyId, capabilityId = '', routeKey, reviewerRef, decision, rubric = {}, independent = true } = {}) {
      if (!String(runId || '').trim()) throw new Error('D30 human review requires the exact empirical runId.');
      if (!Number.isInteger(Number(attemptNo)) || Number(attemptNo) < 1) throw new Error('D30 human review requires a positive attemptNo.');
      if (!['PASS','FAIL','REVIEW_NEEDED'].includes(decision)) throw new Error('Invalid D30 human review decision.');
      if (!String(reviewerRef || '').trim()) throw new Error('Human academic review requires a non-empty reviewer reference.');
      assertNoHiddenChainOfThought(rubric);
      await query(`insert into teaching_runtime.d30_human_reviews
        (id,session_id,run_id,attempt_no,case_id,family_id,capability_id,route_key,reviewer_ref,reviewer_kind,independent,decision,rubric)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'HUMAN_ACADEMIC',$10,$11,$12::jsonb)`,
      [id,sessionId,String(runId),Number(attemptNo),key(caseId),familyId,key(capabilityId),routeKey,String(reviewerRef),independent===true,decision,json(rubric)]);
      return id;
    },
    async recordDefect({ id = randomUUID(), sessionId, caseId = '', familyId = '', capabilityId = '', routeKey = '', severity, code, rootCause = null, description, regressionAnchorId = null, resolved = false, evidence = {} } = {}) {
      if (!['P0','P1','P2','P3'].includes(severity)) throw new Error('Invalid D30 defect severity.');
      await query(`insert into teaching_runtime.d30_defects
        (id,session_id,case_id,family_id,capability_id,route_key,severity,code,root_cause,description,regression_anchor_id,resolved,evidence)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
        on conflict (session_id,code,case_id,route_key) do update set severity=excluded.severity,root_cause=excluded.root_cause,
          description=excluded.description,regression_anchor_id=excluded.regression_anchor_id,resolved=excluded.resolved,evidence=excluded.evidence,updated_at=now()`,
      [id,sessionId,key(caseId),key(familyId),key(capabilityId),key(routeKey),severity,code,rootCause,description,regressionAnchorId,resolved===true,json(evidence)]);
      return id;
    },
    async recordRouteDecision({ id = randomUUID(), sessionId, summary } = {}) {
      assertNoHiddenChainOfThought(summary);
      await query(`insert into teaching_runtime.d30_route_decisions
        (id,session_id,family_id,capability_id,route_key,route_role,decision,specification_complete,production_qualified,production_authorized,authorization_gate,summary)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,'D31',$10::jsonb)
        on conflict (session_id,family_id,capability_id,route_key,route_role) do update set decision=excluded.decision,specification_complete=excluded.specification_complete,
          production_qualified=excluded.production_qualified,production_authorized=false,authorization_gate='D31',summary=excluded.summary,updated_at=now()`,
      [id,sessionId,summary.familyId,key(summary.capabilityId),summary.routeKey,summary.routeRole,summary.decision,summary.specificationComplete===true,summary.productionQualified===true,json(summary)]);
      return id;
    },
    async recordPromptGovernance({ id = randomUUID(), familyId, familyVersion, promptSha256, state, behaviorBriefRef, governance = {} } = {}) {
      await query(`insert into teaching_runtime.d30_prompt_governance
        (id,family_id,family_version,prompt_sha256,state,behavior_brief_ref,governance)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb)
        on conflict (family_id,family_version,prompt_sha256) do update set state=excluded.state,behavior_brief_ref=excluded.behavior_brief_ref,governance=excluded.governance,updated_at=now()`,
      [id,familyId,familyVersion,promptSha256,state,behaviorBriefRef,json(governance)]);
      return id;
    },
    async recordPplComparison({ id = randomUUID(), sessionId, comparisonKey, oneShotSummary, progressiveSummary, decision, evidence = {} } = {}) {
      await query(`insert into teaching_runtime.d30_ppl_comparisons
        (id,session_id,comparison_key,one_shot_summary,progressive_summary,decision,evidence)
        values ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb)
        on conflict (session_id,comparison_key) do update set one_shot_summary=excluded.one_shot_summary,progressive_summary=excluded.progressive_summary,decision=excluded.decision,evidence=excluded.evidence,updated_at=now()`,
      [id,sessionId,comparisonKey,json(oneShotSummary),json(progressiveSummary),decision,json(evidence)]);
      return id;
    },
    async completeSession(sessionId, report) {
      assertNoHiddenChainOfThought(report);
      const status = report.productionQualified === true ? 'QUALIFIED' : report.specificationComplete === true ? 'BLOCKED' : 'FAILED';
      await query(`update teaching_runtime.d30_qualification_sessions set status=$2,report=$3::jsonb,completed_at=now() where id=$1`,[sessionId,status,json(report)]);
      return status;
    },
  });
}

module.exports = { runKey, mapCaseResult, mapHumanReview, createD30Repository };