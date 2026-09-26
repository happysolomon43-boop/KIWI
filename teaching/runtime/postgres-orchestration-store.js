'use strict';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`Teaching orchestration store requires ${name}().`);
  return value;
}

function createPostgresOrchestrationStore({ query } = {}) {
  requireFunction(query, 'query');

  async function assertReady() {
    const { rows } = await query(`
      select
        to_regclass('teaching_runtime.orchestration_executions') as orchestration_executions,
        to_regclass('teaching_runtime.event_outbox') as event_outbox
    `);
    const row = rows?.[0] || {};
    if (!row.orchestration_executions || !row.event_outbox) {
      const error = new Error('Teaching D05 orchestration/runtime schema is not installed.');
      error.code = 'TEACHING_D05_RUNTIME_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function begin(envelope) {
    const values = [
      envelope.execution_id,
      envelope.idempotency_key,
      envelope.trigger.type,
      envelope.trigger.ref,
      envelope.trigger.authority_category,
      envelope.correlation_id,
      envelope.causation_id,
      envelope.capability.id,
      envelope.capability.execution_class,
      envelope.capability.authority_ceiling,
      envelope.capability.authoritative_owner_boundary,
      envelope.prompt_contract?.family_id || null,
      envelope.prompt_contract?.family_version || null,
      envelope.prompt_contract?.structural_contract_version || null,
      envelope.state_reference?.aggregate_type || null,
      envelope.state_reference?.aggregate_id || null,
      envelope.state_reference?.state_version || null,
      envelope.state_reference?.precondition_token || null,
      JSON.stringify(envelope.preconditions || {}),
      JSON.stringify(envelope.provenance_refs || []),
      envelope.result_contract.output_schema_id,
      envelope.result_contract.output_schema_version,
      JSON.stringify(envelope.result_contract.validator_ids || []),
      envelope.deadline_at,
      JSON.stringify(envelope.audit_metadata || {}),
    ];

    const inserted = await query(
      `insert into teaching_runtime.orchestration_executions (
         execution_id,idempotency_key,trigger_type,trigger_ref,trigger_authority_category,
         correlation_id,causation_id,capability_id,execution_class,authority_level,
         authoritative_owner_boundary,prompt_family_id,prompt_family_version,prompt_contract_version,
         aggregate_type,aggregate_id,state_version_ref,precondition_token,preconditions,
         provenance_refs,output_schema_id,output_schema_version,validator_ids,deadline_at,safe_metadata
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,
         $20::jsonb,$21,$22,$23::jsonb,$24,$25::jsonb
       )
       on conflict (idempotency_key) where idempotency_key is not null do nothing
       returning *`,
      values
    );

    if (inserted.rows?.[0]) return Object.freeze({ inserted: true, execution: inserted.rows[0] });
    if (!envelope.idempotency_key) {
      const error = new Error('Teaching orchestration execution could not be inserted.');
      error.code = 'TEACHING_D05_EXECUTION_INSERT_FAILED';
      throw error;
    }
    const existing = await query(
      'select * from teaching_runtime.orchestration_executions where idempotency_key=$1 limit 1',
      [envelope.idempotency_key]
    );
    const row = existing.rows?.[0];
    if (!row) throw new Error('Teaching orchestration idempotency conflict could not be resolved.');
    if (row.capability_id !== envelope.capability.id || row.trigger_ref !== envelope.trigger.ref) {
      const error = new Error('Teaching orchestration idempotency key is bound to a different execution identity.');
      error.code = 'TEACHING_D05_IDEMPOTENCY_CONFLICT';
      throw error;
    }
    return Object.freeze({ inserted: false, execution: row });
  }

  async function mark(executionId, status, {
    validationOutcome = null,
    staleReasons = [],
    failureCode = null,
    mutationRef = null,
    safeMetadata = {},
  } = {}) {
    const { rows } = await query(
      `update teaching_runtime.orchestration_executions
          set status=$2,
              validation_outcome=coalesce($3,validation_outcome),
              stale_reasons=$4::jsonb,
              failure_code=$5,
              committed_mutation_ref=$6,
              safe_metadata=safe_metadata || $7::jsonb,
              completed_at=case when $2 in ('COMPLETED','NOOP','STALE_REJECTED','FAILED','CANCELLED') then now() else completed_at end,
              updated_at=now()
        where execution_id=$1
        returning *`,
      [executionId,status,validationOutcome,JSON.stringify(staleReasons || []),failureCode,mutationRef,JSON.stringify(safeMetadata || {})]
    );
    if (!rows?.[0]) {
      const error = new Error(`Unknown Teaching orchestration execution: ${executionId}`);
      error.code = 'TEACHING_D05_EXECUTION_NOT_FOUND';
      throw error;
    }
    return rows[0];
  }

  async function get(executionId) {
    const { rows } = await query(
      'select * from teaching_runtime.orchestration_executions where execution_id=$1 limit 1',
      [executionId]
    );
    return rows?.[0] || null;
  }

  return Object.freeze({ assertReady, begin, mark, get });
}

module.exports = { createPostgresOrchestrationStore };
