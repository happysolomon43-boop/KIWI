'use strict';

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

function createPostgresAIStore({ query, randomUUID }) {
  if (typeof query !== 'function') throw new Error('AI store requires query');
  if (typeof randomUUID !== 'function') throw new Error('AI store requires randomUUID');

  async function upsertCatalogModel(model) {
    await query(
      `INSERT INTO ai_model_catalog (
         model_id, family, channel, status, rank,
         supported_thinking, capabilities,
         input_token_limit, output_token_limit,
         metadata, first_seen_at, last_seen_at,
         approved_at, suspended_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,
         COALESCE($11, now()), now(), $12, $13, now()
       )
       ON CONFLICT (model_id) DO UPDATE SET
         family = EXCLUDED.family,
         channel = EXCLUDED.channel,
         status = EXCLUDED.status,
         rank = EXCLUDED.rank,
         supported_thinking = EXCLUDED.supported_thinking,
         capabilities = EXCLUDED.capabilities,
         input_token_limit = EXCLUDED.input_token_limit,
         output_token_limit = EXCLUDED.output_token_limit,
         metadata = EXCLUDED.metadata,
         last_seen_at = now(),
         approved_at = COALESCE(EXCLUDED.approved_at, ai_model_catalog.approved_at),
         suspended_at = EXCLUDED.suspended_at,
         updated_at = now()`,
      [
        model.id,
        model.family,
        model.channel,
        model.status,
        Number(model.rank) || 0,
        json(model.supportedThinking || []),
        json(model.capabilities || []),
        model.inputTokenLimit ?? null,
        model.outputTokenLimit ?? null,
        json(model.metadata || {}),
        model.firstSeenAt || null,
        model.approvedAt || null,
        model.suspendedAt || null,
      ]
    );
  }

  async function seedCatalog(models) {
    for (const model of models || []) {
      await upsertCatalogModel(model);
    }
  }

  async function loadProjectModelStates() {
    const { rows } = await query(
      `SELECT *
       FROM ai_project_model_state`
    );
    return rows;
  }

  async function upsertProjectModelState(state) {
    const { rows } = await query(
      `INSERT INTO ai_project_model_state (
         project_slot, model_id, state, quota_day,
         attempts_today, successes_today, observed_quota_limit,
         cooldown_until, last_error_code, last_http_status,
         last_success_at, last_failure_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()
       )
       ON CONFLICT (project_slot, model_id) DO UPDATE SET
         state = EXCLUDED.state,
         quota_day = EXCLUDED.quota_day,
         attempts_today = EXCLUDED.attempts_today,
         successes_today = EXCLUDED.successes_today,
         observed_quota_limit = EXCLUDED.observed_quota_limit,
         cooldown_until = EXCLUDED.cooldown_until,
         last_error_code = EXCLUDED.last_error_code,
         last_http_status = EXCLUDED.last_http_status,
         last_success_at = EXCLUDED.last_success_at,
         last_failure_at = EXCLUDED.last_failure_at,
         updated_at = now()
       RETURNING *`,
      [
        state.projectSlot,
        state.modelId,
        state.state,
        state.quotaDay || null,
        Number(state.attemptsToday) || 0,
        Number(state.successesToday) || 0,
        state.observedQuotaLimit ?? null,
        state.cooldownUntil || null,
        state.lastErrorCode || null,
        state.lastHttpStatus ?? null,
        state.lastSuccessAt || null,
        state.lastFailureAt || null,
      ]
    );
    return rows[0] || null;
  }

  async function createRequest(record) {
    const id = record.id || randomUUID();
    await query(
      `INSERT INTO ai_requests (
         id, task_id, class, mode, requested_reasoning,
         planned_models, planned_primary_model, legacy_model,
         selected_model, selected_project_slot, outcome,
         fallback_depth, attempt_count, latency_ms,
         input_tokens, output_tokens, thought_tokens, total_tokens,
         finish_reason, error_code, generation_group_id,
         started_at, completed_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,COALESCE($22, now()),$23
       )`,
      [
        id,
        record.taskId,
        record.class,
        record.mode,
        record.requestedReasoning || null,
        json(record.plannedModels || []),
        record.plannedPrimaryModel || null,
        record.legacyModel || null,
        record.selectedModel || null,
        record.selectedProjectSlot || null,
        record.outcome || 'PENDING',
        Number(record.fallbackDepth) || 0,
        Number(record.attemptCount) || 0,
        record.latencyMs ?? null,
        Number(record.inputTokens) || 0,
        Number(record.outputTokens) || 0,
        Number(record.thoughtTokens) || 0,
        Number(record.totalTokens) || 0,
        record.finishReason || null,
        record.errorCode || null,
        record.generationGroupId || null,
        record.startedAt || null,
        record.completedAt || null,
      ]
    );
    return id;
  }

  async function finishRequest(id, record) {
    await query(
      `UPDATE ai_requests SET
         selected_model = $2,
         selected_project_slot = $3,
         outcome = $4,
         fallback_depth = $5,
         attempt_count = $6,
         latency_ms = $7,
         input_tokens = $8,
         output_tokens = $9,
         thought_tokens = $10,
         total_tokens = $11,
         finish_reason = $12,
         error_code = $13,
         completed_at = COALESCE($14, now())
       WHERE id = $1`,
      [
        id,
        record.selectedModel || null,
        record.selectedProjectSlot || null,
        record.outcome,
        Number(record.fallbackDepth) || 0,
        Number(record.attemptCount) || 0,
        record.latencyMs ?? null,
        Number(record.inputTokens) || 0,
        Number(record.outputTokens) || 0,
        Number(record.thoughtTokens) || 0,
        Number(record.totalTokens) || 0,
        record.finishReason || null,
        record.errorCode || null,
        record.completedAt || null,
      ]
    );
  }

  async function recordAttempt(record) {
    await query(
      `INSERT INTO ai_attempts (
         request_id, attempt_number, model_id, project_slot,
         outcome, error_code, http_status, finish_reason, latency_ms,
         input_tokens, output_tokens, thought_tokens, total_tokens,
         started_at, completed_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
         COALESCE($14, now()),COALESCE($15, now())
       )`,
      [
        record.requestId,
        Number(record.attemptNumber) || 1,
        record.modelId || null,
        record.projectSlot || null,
        record.outcome,
        record.errorCode || null,
        record.httpStatus ?? null,
        record.finishReason || null,
        record.latencyMs ?? null,
        Number(record.inputTokens) || 0,
        Number(record.outputTokens) || 0,
        Number(record.thoughtTokens) || 0,
        Number(record.totalTokens) || 0,
        record.startedAt || null,
        record.completedAt || null,
      ]
    );
  }

  async function incrementDailyRollup({
    quotaDay,
    taskId,
    class: taskClass,
    mode,
    outcome,
    fallbackDepth = 0,
    latencyMs = 0,
    usage = {},
  }) {
    const success = outcome === 'SUCCESS' ? 1 : 0;
    const blocked = outcome === 'BLOCKED' ? 1 : 0;
    const failure = outcome === 'FAILED' ? 1 : 0;

    await query(
      `INSERT INTO ai_daily_rollups (
         quota_day, task_id, class, mode,
         request_count, success_count, failure_count, blocked_count,
         fallback_count, total_latency_ms,
         input_tokens, output_tokens, thought_tokens, total_tokens, updated_at
       ) VALUES (
         $1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()
       )
       ON CONFLICT (quota_day, task_id, mode) DO UPDATE SET
         request_count = ai_daily_rollups.request_count + 1,
         success_count = ai_daily_rollups.success_count + EXCLUDED.success_count,
         failure_count = ai_daily_rollups.failure_count + EXCLUDED.failure_count,
         blocked_count = ai_daily_rollups.blocked_count + EXCLUDED.blocked_count,
         fallback_count = ai_daily_rollups.fallback_count + EXCLUDED.fallback_count,
         total_latency_ms = ai_daily_rollups.total_latency_ms + EXCLUDED.total_latency_ms,
         input_tokens = ai_daily_rollups.input_tokens + EXCLUDED.input_tokens,
         output_tokens = ai_daily_rollups.output_tokens + EXCLUDED.output_tokens,
         thought_tokens = ai_daily_rollups.thought_tokens + EXCLUDED.thought_tokens,
         total_tokens = ai_daily_rollups.total_tokens + EXCLUDED.total_tokens,
         updated_at = now()`,
      [
        quotaDay,
        taskId,
        taskClass,
        mode,
        success,
        failure,
        blocked,
        fallbackDepth > 0 ? 1 : 0,
        Number(latencyMs) || 0,
        Number(usage.inputTokens) || 0,
        Number(usage.outputTokens) || 0,
        Number(usage.thoughtTokens) || 0,
        Number(usage.totalTokens) || 0,
      ]
    );
  }

  return Object.freeze({
    upsertCatalogModel,
    seedCatalog,
    loadProjectModelStates,
    upsertProjectModelState,
    createRequest,
    finishRequest,
    recordAttempt,
    incrementDailyRollup,
  });
}

module.exports = {
  createPostgresAIStore,
};
