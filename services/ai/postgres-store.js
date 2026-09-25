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


  async function loadCatalogModels() {
    const { rows } = await query(
      `SELECT *
       FROM ai_model_catalog
       ORDER BY rank DESC, model_id ASC`
    );
    return rows;
  }

  async function loadProjectModelStates() {
    const { rows } = await query(
      `SELECT *
       FROM ai_project_model_state`
    );
    return rows;
  }

  async function loadProviderModelHealth() {
    const { rows } = await query(
      `SELECT *
       FROM ai_provider_model_health
       ORDER BY model_id ASC`
    );
    return rows;
  }

  async function upsertProviderModelHealth(state) {
    const { rows } = await query(
      `INSERT INTO ai_provider_model_health (
         model_id, state, open_until, failure_slots,
         last_error_code, last_http_status,
         last_failure_at, last_success_at, updated_at
       ) VALUES (
         $1,$2,$3,$4::jsonb,$5,$6,$7,$8,now()
       )
       ON CONFLICT (model_id) DO UPDATE SET
         state = EXCLUDED.state,
         open_until = EXCLUDED.open_until,
         failure_slots = EXCLUDED.failure_slots,
         last_error_code = EXCLUDED.last_error_code,
         last_http_status = EXCLUDED.last_http_status,
         last_failure_at = EXCLUDED.last_failure_at,
         last_success_at = EXCLUDED.last_success_at,
         updated_at = now()
       RETURNING *`,
      [
        state.modelId,
        state.state,
        state.openUntil || null,
        json(state.failureSlots || []),
        state.lastErrorCode || null,
        state.lastHttpStatus ?? null,
        state.lastFailureAt || null,
        state.lastSuccessAt || null,
      ]
    );
    return rows[0] || null;
  }

  async function upsertProjectModelState(state) {
    const { rows } = await query(
      `INSERT INTO ai_project_model_state (
         project_slot, model_id, state, quota_day,
         attempts_today, successes_today, observed_quota_limit,
         observed_quota_dimension, cooldown_until, last_error_code,
         last_http_status, last_success_at, last_failure_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()
       )
       ON CONFLICT (project_slot, model_id) DO UPDATE SET
         state = EXCLUDED.state,
         quota_day = EXCLUDED.quota_day,
         attempts_today = EXCLUDED.attempts_today,
         successes_today = EXCLUDED.successes_today,
         observed_quota_limit = EXCLUDED.observed_quota_limit,
         observed_quota_dimension = EXCLUDED.observed_quota_dimension,
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
        state.observedQuotaDimension || null,
        state.cooldownUntil || null,
        state.lastErrorCode || null,
        state.lastHttpStatus ?? null,
        state.lastSuccessAt || null,
        state.lastFailureAt || null,
      ]
    );
    return rows[0] || null;
  }


  async function recordModelQualification(record) {
    const { rows } = await query(
      `INSERT INTO ai_model_qualifications (
         model_id, status, project_slot, qualification_version,
         supported_thinking, capabilities, probe_count,
         error_code, reason, metadata, started_at, completed_at
       ) VALUES (
         $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,
         COALESCE($11, now()),$12
       )
       RETURNING id`,
      [
        record.modelId,
        record.status,
        record.projectSlot || null,
        Number(record.qualificationVersion) || 1,
        json(record.supportedThinking || []),
        json(record.capabilities || []),
        Number(record.probeCount) || 0,
        record.errorCode || null,
        record.reason || null,
        json(record.metadata || {}),
        record.startedAt || null,
        record.completedAt || null,
      ]
    );
    return rows[0]?.id || null;
  }

  async function latestModelQualification(modelId) {
    const { rows } = await query(
      `SELECT *
       FROM ai_model_qualifications
       WHERE model_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [modelId]
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
         completed_at = COALESCE($14, now()),
         queue_wait_ms = $15,
         admission_limit = $16,
         congestion_level = $17
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
        Number(record.queueWaitMs) || 0,
        record.admissionLimit == null ? null : Number(record.admissionLimit),
        record.congestionLevel || null,
      ]
    );
  }

  async function recordAttempt(record) {
    await query(
      `INSERT INTO ai_attempts (
         request_id, attempt_number, model_id, project_slot,
         outcome, error_code, http_status, finish_reason, latency_ms,
         input_tokens, output_tokens, thought_tokens, total_tokens,
         provider_error_code, provider_status, quota_dimension,
         quota_metric, quota_limit_name, quota_limit_value,
         retry_after_ms, classification_source,
         route_state_before, route_state_after,
         operation_id, operation_attempt_number,
         started_at, completed_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
         $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
         COALESCE($26, now()),COALESCE($27, now())
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
        record.providerErrorCode || null,
        record.providerStatus || null,
        record.quotaDimension || null,
        record.quotaMetric || null,
        record.quotaLimitName || null,
        record.quotaLimitValue == null ? null : Number(record.quotaLimitValue),
        record.retryAfterMs == null ? null : Number(record.retryAfterMs),
        record.classificationSource || null,
        record.routeStateBefore || null,
        record.routeStateAfter || null,
        record.operationId || null,
        record.operationAttemptNumber == null ? null : Number(record.operationAttemptNumber),
        record.startedAt || null,
        record.completedAt || null,
      ]
    );
  }


  async function recentOperationalSummary({
    windowMinutes = 15,
  } = {}) {
    const minutes = Math.max(1, Math.min(Math.floor(Number(windowMinutes) || 15), 1440));

    const [requestResult, taskResult, attemptResult] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int AS requests,
           COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::int AS successes,
           COUNT(*) FILTER (WHERE outcome = 'FAILED')::int AS failures,
           COUNT(*) FILTER (WHERE outcome = 'BLOCKED')::int AS blocked,
           COUNT(*) FILTER (WHERE outcome = 'PENDING')::int AS pending,
           COUNT(*) FILTER (WHERE fallback_depth > 0)::int AS fallback_requests,
           COALESCE(ROUND(AVG(latency_ms))::int, 0) AS average_latency_ms,
           COALESCE(ROUND(AVG(queue_wait_ms))::int, 0) AS average_queue_wait_ms,
           COALESCE(MAX(queue_wait_ms), 0)::int AS max_queue_wait_ms,
           COALESCE(ROUND(AVG(admission_limit))::int, 0) AS average_admission_limit
         FROM ai_requests
         WHERE mode = 'LIVE'
           AND started_at >= NOW() - ($1::integer * INTERVAL '1 minute')`,
        [minutes]
      ),
      query(
        `SELECT
           task_id,
           class,
           COUNT(*)::int AS requests,
           COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::int AS successes,
           COUNT(*) FILTER (WHERE outcome = 'FAILED')::int AS failures,
           COUNT(*) FILTER (WHERE fallback_depth > 0)::int AS fallback_requests,
           COALESCE(ROUND(AVG(queue_wait_ms))::int, 0) AS average_queue_wait_ms,
           MAX(started_at) AS last_request_at
         FROM ai_requests
         WHERE mode = 'LIVE'
           AND started_at >= NOW() - ($1::integer * INTERVAL '1 minute')
         GROUP BY task_id, class
         ORDER BY requests DESC, task_id ASC`,
        [minutes]
      ),
      query(
        `SELECT
           model_id,
           project_slot,
           outcome,
           error_code,
           http_status,
           COUNT(*)::int AS attempts,
           MAX(created_at) AS last_seen_at
         FROM ai_attempts
         WHERE created_at >= NOW() - ($1::integer * INTERVAL '1 minute')
         GROUP BY model_id, project_slot, outcome, error_code, http_status
         ORDER BY attempts DESC, model_id ASC NULLS LAST, project_slot ASC NULLS LAST
         LIMIT 250`,
        [minutes]
      ),
    ]);

    return Object.freeze({
      windowMinutes: minutes,
      requests: Object.freeze(requestResult?.rows?.[0] || {
        requests: 0,
        successes: 0,
        failures: 0,
        blocked: 0,
        pending: 0,
        fallback_requests: 0,
        average_latency_ms: 0,
        average_queue_wait_ms: 0,
        max_queue_wait_ms: 0,
        average_admission_limit: 0,
      }),
      tasks: Object.freeze([...(taskResult?.rows || [])]),
      attempts: Object.freeze([...(attemptResult?.rows || [])]),
    });
  }


  async function cleanupOperationalHistory({
    requestRetentionDays = 30,
    qualificationRetentionDays = 180,
    rollupRetentionDays = 365,
  } = {}) {
    const requestDays = Math.max(7, Math.min(Number(requestRetentionDays) || 30, 180));
    const qualificationDays = Math.max(30, Math.min(Number(qualificationRetentionDays) || 180, 730));
    const rollupDays = Math.max(90, Math.min(Number(rollupRetentionDays) || 365, 1825));

    const requests = await query(
      `DELETE FROM ai_requests
       WHERE created_at < NOW() - ($1::double precision * INTERVAL '1 day')`,
      [requestDays]
    );

    // Keep the latest qualification row for each model forever so operators
    // retain the reason/status behind the model's current lifecycle decision.
    const qualifications = await query(
      `DELETE FROM ai_model_qualifications q
       WHERE q.created_at < NOW() - ($1::double precision * INTERVAL '1 day')
         AND q.id NOT IN (
           SELECT DISTINCT ON (model_id) id
           FROM ai_model_qualifications
           ORDER BY model_id, created_at DESC, id DESC
         )`,
      [qualificationDays]
    );

    const rollups = await query(
      `DELETE FROM ai_daily_rollups
       WHERE quota_day < (CURRENT_DATE - $1::integer)`,
      [Math.floor(rollupDays)]
    );

    return {
      requestsDeleted: Number(requests?.rowCount) || 0,
      qualificationsDeleted: Number(qualifications?.rowCount) || 0,
      rollupsDeleted: Number(rollups?.rowCount) || 0,
      requestRetentionDays: requestDays,
      qualificationRetentionDays: qualificationDays,
      rollupRetentionDays: rollupDays,
    };
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
    loadCatalogModels,
    loadProjectModelStates,
    upsertProjectModelState,
    loadProviderModelHealth,
    upsertProviderModelHealth,
    recordModelQualification,
    latestModelQualification,
    createRequest,
    finishRequest,
    recordAttempt,
    recentOperationalSummary,
    cleanupOperationalHistory,
    incrementDailyRollup,
  });
}

module.exports = {
  createPostgresAIStore,
};
