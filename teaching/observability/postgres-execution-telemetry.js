'use strict';

const {
  assertIntelligenceClass,
  assertAuthorityLevel,
} = require('../ai/contracts');

function createPostgresTeachingExecutionTelemetry({
  query,
  randomUUID,
} = {}) {
  if (typeof query !== 'function') {
    throw new TypeError('Teaching execution telemetry requires query().');
  }
  if (typeof randomUUID !== 'function') {
    throw new TypeError('Teaching execution telemetry requires randomUUID().');
  }

  async function assertReady() {
    const { rows } = await query(
      `SELECT to_regclass('teaching_runtime.ai_execution_audit') AS audit_table`
    );
    if (!rows?.[0]?.audit_table) {
      const error = new Error('Teaching D02 AI execution audit schema is not installed.');
      error.code = 'TEACHING_RUNTIME_SCHEMA_MISSING';
      throw error;
    }
    return true;
  }

  async function beginExecution({
    executionId = null,
    correlationId = null,
    causationId = null,
    responsibilityKey,
    intelligenceClass,
    authorityLevel,
    centralTaskId,
    promptTemplateVersion = null,
    outputSchemaVersion = null,
    authoritativeOwner = null,
  } = {}) {
    if (typeof responsibilityKey !== 'string' || !responsibilityKey.trim()) {
      throw new TypeError('Teaching AI execution requires responsibilityKey.');
    }
    if (typeof centralTaskId !== 'string' || !centralTaskId.trim()) {
      throw new TypeError('Teaching AI execution requires centralTaskId.');
    }

    const id = executionId || randomUUID();
    const klass = assertIntelligenceClass(intelligenceClass);
    const authority = assertAuthorityLevel(authorityLevel);

    await query(
      `INSERT INTO teaching_runtime.ai_execution_audit (
         execution_id, correlation_id, causation_id, responsibility_key,
         intelligence_class, authority_level, central_task_id,
         prompt_template_version, output_schema_version, authoritative_owner,
         validation_outcome, started_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING',now())`,
      [
        id,
        correlationId,
        causationId,
        responsibilityKey.trim(),
        klass,
        authority,
        centralTaskId.trim(),
        promptTemplateVersion,
        outputSchemaVersion,
        authoritativeOwner,
      ]
    );

    return id;
  }

  async function finishExecution(executionId, {
    modelIdentifier = null,
    validationOutcome,
    rejectionReason = null,
    safeFailureCode = null,
    outcome = null,
  } = {}) {
    await query(
      `UPDATE teaching_runtime.ai_execution_audit
          SET model_identifier = $2,
              validation_outcome = $3,
              rejection_reason = $4,
              safe_failure_code = $5,
              outcome = $6,
              completed_at = now()
        WHERE execution_id = $1`,
      [
        executionId,
        modelIdentifier,
        validationOutcome,
        rejectionReason,
        safeFailureCode,
        outcome,
      ]
    );
    return true;
  }

  async function recordAuthoritativeCommit(executionId, {
    owner,
    mutationType,
    mutationRef = null,
  } = {}) {
    await query(
      `UPDATE teaching_runtime.ai_execution_audit
          SET authoritative_owner = COALESCE($2, authoritative_owner),
              committed_mutation_type = $3,
              committed_mutation_ref = $4,
              updated_at = now()
        WHERE execution_id = $1`,
      [executionId, owner, mutationType, mutationRef]
    );
    return true;
  }

  return Object.freeze({
    assertReady,
    beginExecution,
    finishExecution,
    recordAuthoritativeCommit,
  });
}

module.exports = {
  createPostgresTeachingExecutionTelemetry,
};
