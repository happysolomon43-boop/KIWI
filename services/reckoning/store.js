'use strict';

const crypto = require('node:crypto');
const { ReckoningContractError } = require('./errors');

const SESSION_FIELD_MAP = Object.freeze({
  engineVersion: 'engine_version',
  engineMode: 'engine_mode',
  enginePhase: 'engine_phase',
  questionsUsed: 'questions_used',
  softQuestionBudget: 'soft_question_budget',
  hardQuestionCap: 'hard_question_cap',
  recoveryScore: 'recovery_score',
  rawAccuracy: 'raw_accuracy',
  unresolvedCriticalCount: 'unresolved_critical_count',
  currentBlock: 'current_block',
  currentQuestionId: 'current_question_id',
  stateVersion: 'state_version',
  preparedAt: 'prepared_at',
  reviewStartedAt: 'review_started_at',
  safetyExpiresAt: 'safety_expires_at',
  generationStatus: 'generation_status',
  generationError: 'generation_error',
  plannerVersion: 'planner_version',
  configVersion: 'config_version',
  checkpointPending: 'checkpoint_pending',
  checkpointNextQuestionId: 'checkpoint_next_question_id',
  finalReport: 'final_report',
});

const EVIDENCE_FIELD_MAP = Object.freeze({
  sourceCardId: 'source_card_id',
  conceptKey: 'concept_key',
  sourceSnapshot: 'source_snapshot',
  sourceHash: 'source_hash',
  originalCardState: 'original_card_state',
  riskScore: 'risk_score',
  riskLevel: 'risk_level',
  riskReasons: 'risk_reasons',
  isBubbleCritical: 'is_bubble_critical',
  hasLearningDebt: 'has_learning_debt',
  discoveredByControl: 'discovered_by_control',
  evidenceStatus: 'evidence_status',
  diagnosticOutcome: 'diagnostic_outcome',
  challengeOutcome: 'challenge_outcome',
  confirmationOutcome: 'confirmation_outcome',
  attemptCount: 'attempt_count',
  successfulDemonstrations: 'successful_demonstrations',
  requiredConfirmations: 'required_confirmations',
  questionsSeen: 'questions_seen',
  lastQuestionRole: 'last_question_role',
  confirmationNotBeforeQuestion: 'confirmation_not_before_question',
  nextEligibleQuestion: 'next_eligible_question',
  resolvedAt: 'resolved_at',
  learningEffectAppliedAt: 'learning_effect_applied_at',
});

const JSON_EVIDENCE_FIELDS = new Set(['sourceSnapshot', 'riskReasons']);
const JSON_SESSION_FIELDS = new Set(['finalReport']);

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function createPatchQuery({ table, idColumn = 'id', id, patch, fieldMap, jsonFields = new Set() }) {
  const entries = Object.entries(patch || {}).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    throw new ReckoningContractError(`No fields supplied for ${table} update.`);
  }

  const values = [id];
  const assignments = entries.map(([key, value], index) => {
    const column = fieldMap[key];
    if (!column) {
      throw new ReckoningContractError(`Unsupported ${table} field: ${key}`);
    }
    values.push(jsonFields.has(key) ? json(value) : value);
    const cast = jsonFields.has(key) ? '::jsonb' : '';
    return `${column} = $${index + 2}${cast}`;
  });

  return {
    sql: `UPDATE ${table}
          SET ${assignments.join(', ')}, updated_at = now()
          WHERE ${idColumn} = $1
          RETURNING *`,
    values,
  };
}

function createReckoningStore({
  query,
  transaction,
  randomUUID = crypto.randomUUID,
} = {}) {
  function requireQuery() {
    if (typeof query !== 'function') {
      throw new ReckoningContractError('Reckoning store requires a query function.');
    }
  }

  async function getSession(
    reckoningId,
    userId = null,
    { forUpdate = false } = {}
  ) {
    requireQuery();
    const params = [reckoningId];
    let sql = 'SELECT * FROM reckoning_sessions WHERE id = $1';

    if (userId != null) {
      params.push(userId);
      sql += ' AND user_id = $2';
    }

    sql += ' LIMIT 1';
    if (forUpdate) sql += ' FOR UPDATE';
    const { rows } = await query(sql, params);
    return rows?.[0] || null;
  }

  async function getEvidence(reckoningId) {
    requireQuery();
    const { rows } = await query(
      `SELECT *
       FROM reckoning_evidence
       WHERE reckoning_id = $1
       ORDER BY risk_score DESC, created_at ASC, id ASC`,
      [reckoningId]
    );
    return rows || [];
  }

  async function createEvidence(record) {
    requireQuery();
    if (!record?.reckoningId) {
      throw new ReckoningContractError('Evidence requires reckoningId.');
    }
    if (!record?.userId) {
      throw new ReckoningContractError('Evidence requires userId.');
    }
    if (!record?.conceptKey) {
      throw new ReckoningContractError('Evidence requires conceptKey.');
    }
    if (!record?.riskLevel) {
      throw new ReckoningContractError('Evidence requires riskLevel.');
    }

    const id = record.id || randomUUID();
    const { rows } = await query(
      `INSERT INTO reckoning_evidence (
         id, reckoning_id, user_id, subject_id, source_card_id, concept_key,
         source_snapshot, source_hash, original_card_state,
         risk_score, risk_level, risk_reasons,
         is_bubble_critical, has_learning_debt, discovered_by_control,
         evidence_status, required_confirmations
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,
         $13,$14,$15,$16,$17
       )
       RETURNING *`,
      [
        id,
        record.reckoningId,
        record.userId,
        record.subjectId || null,
        record.sourceCardId || null,
        record.conceptKey,
        json(record.sourceSnapshot || {}),
        record.sourceHash || null,
        record.originalCardState || null,
        Number(record.riskScore) || 0,
        record.riskLevel,
        json(record.riskReasons || []),
        Boolean(record.isBubbleCritical),
        Boolean(record.hasLearningDebt),
        Boolean(record.discoveredByControl),
        record.evidenceStatus || 'UNTESTED',
        Number(record.requiredConfirmations) || 0,
      ]
    );

    return rows?.[0] || null;
  }

  async function upsertEvidence(record) {
    requireQuery();
    if (!record?.reckoningId || !record?.userId || !record?.sourceCardId) {
      throw new ReckoningContractError(
        'Shadow evidence requires reckoningId, userId and sourceCardId.'
      );
    }
    if (!record?.conceptKey || !record?.riskLevel) {
      throw new ReckoningContractError('Shadow evidence requires conceptKey and riskLevel.');
    }

    const id = record.id || randomUUID();
    const { rows } = await query(
      `INSERT INTO reckoning_evidence (
         id, reckoning_id, user_id, subject_id, source_card_id, concept_key,
         source_snapshot, source_hash, original_card_state,
         risk_score, risk_level, risk_reasons,
         is_bubble_critical, has_learning_debt, discovered_by_control,
         evidence_status, required_confirmations, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,
         $13,$14,$15,$16,$17,now()
       )
       ON CONFLICT (reckoning_id, source_card_id)
       WHERE source_card_id IS NOT NULL
       DO UPDATE SET
         concept_key = EXCLUDED.concept_key,
         source_snapshot = EXCLUDED.source_snapshot,
         source_hash = EXCLUDED.source_hash,
         original_card_state = EXCLUDED.original_card_state,
         risk_score = EXCLUDED.risk_score,
         risk_level = EXCLUDED.risk_level,
         risk_reasons = EXCLUDED.risk_reasons,
         is_bubble_critical = EXCLUDED.is_bubble_critical,
         has_learning_debt = EXCLUDED.has_learning_debt,
         discovered_by_control = EXCLUDED.discovered_by_control,
         required_confirmations = EXCLUDED.required_confirmations,
         updated_at = now()
       RETURNING *`,
      [
        id,
        record.reckoningId,
        record.userId,
        record.subjectId || null,
        record.sourceCardId,
        record.conceptKey,
        json(record.sourceSnapshot || {}),
        record.sourceHash || null,
        record.originalCardState || null,
        Number(record.riskScore) || 0,
        record.riskLevel,
        json(record.riskReasons || []),
        Boolean(record.isBubbleCritical),
        Boolean(record.hasLearningDebt),
        Boolean(record.discoveredByControl),
        record.evidenceStatus || 'UNTESTED',
        Number(record.requiredConfirmations) || 0,
      ]
    );

    return rows?.[0] || null;
  }

  async function getPreparationManifest(
    reckoningId,
    userId,
    { forUpdate = false } = {}
  ) {
    requireQuery();
    let sql = `SELECT *
               FROM reckoning_preparation_manifests
               WHERE reckoning_id = $1 AND user_id = $2
               LIMIT 1`;
    if (forUpdate) sql += ' FOR UPDATE';
    const { rows } = await query(sql, [reckoningId, userId]);
    return rows?.[0] || null;
  }

  async function createPreparationManifest(record = {}) {
    requireQuery();
    if (!record.reckoningId || !record.userId) {
      throw new ReckoningContractError(
        'Preparation manifest requires reckoningId and userId.'
      );
    }
    const totalCount = Math.max(1, Number(record.totalCount) || 0);
    const { rows } = await query(
      `INSERT INTO reckoning_preparation_manifests (
         reckoning_id, user_id, preparation_version, config_version,
         generation_group_id, plan, blueprints, family_order, deck_ids,
         total_count, ready_count, status, last_error,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,
         $10,0,'BUILDING',NULL,now(),now()
       )
       ON CONFLICT (reckoning_id) DO NOTHING
       RETURNING *`,
      [
        record.reckoningId,
        record.userId,
        Math.max(1, Number(record.preparationVersion) || 1),
        Math.max(1, Number(record.configVersion) || 1),
        record.generationGroupId || record.reckoningId,
        json(record.plan || {}),
        json(record.blueprints || []),
        json(record.familyOrder || []),
        json(record.deckIds || []),
        totalCount,
      ]
    );
    if (rows?.[0]) return rows[0];
    return getPreparationManifest(record.reckoningId, record.userId);
  }

  async function getPreparationItems(reckoningId, userId) {
    requireQuery();
    const { rows } = await query(
      `SELECT *
       FROM reckoning_preparation_items
       WHERE reckoning_id = $1 AND user_id = $2
       ORDER BY family_index ASC, item_index ASC, created_at ASC, id ASC`,
      [reckoningId, userId]
    );
    return rows || [];
  }

  async function refreshPreparationProgress(reckoningId, userId, lastError = undefined) {
    requireQuery();
    const params = [reckoningId, userId];
    if (lastError !== undefined) {
      params.push(
        lastError == null
          ? null
          : String(lastError?.message || lastError).slice(0, 1500)
      );
    }
    const errorSql = '';
    const { rows } = await query(
      `UPDATE reckoning_preparation_manifests manifest
       SET ready_count = progress.ready_count,
           status = CASE
             WHEN progress.ready_count >= manifest.total_count THEN 'READY'
             WHEN progress.ready_count > 0 THEN 'PARTIAL'
             ELSE 'BUILDING'
           END
           ${errorSql},
           last_error = CASE
             WHEN progress.ready_count >= manifest.total_count THEN NULL
             ELSE ${lastError !== undefined ? '$3' : 'manifest.last_error'}
           END,
           completed_at = CASE
             WHEN progress.ready_count >= manifest.total_count
               THEN COALESCE(manifest.completed_at, now())
             ELSE NULL
           END,
           updated_at = now()
       FROM (
         SELECT COUNT(*) FILTER (WHERE status = 'READY')::integer AS ready_count
         FROM reckoning_preparation_items
         WHERE reckoning_id = $1 AND user_id = $2
       ) progress
       WHERE manifest.reckoning_id = $1
         AND manifest.user_id = $2
       RETURNING manifest.*`,
      params
    );
    return rows?.[0] || null;
  }

  async function savePreparationItemReady(reckoningId, userId, {
    blueprint,
    question,
    generationAttempts = 1,
    familyIndex = 0,
    itemIndex = 0,
  } = {}) {
    requireQuery();
    if (!blueprint?.id || !blueprint?.evidenceId || !question) {
      throw new ReckoningContractError(
        'Prepared question persistence requires blueprint and question data.'
      );
    }
    const id = randomUUID();
    const { rows } = await query(
      `INSERT INTO reckoning_preparation_items (
         id, reckoning_id, user_id, blueprint_id, evidence_id,
         family_index, item_index, status, generated_question,
         attempt_count, validation_issues, last_error, ready_at,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'READY',$8::jsonb,
         $9,'[]'::jsonb,NULL,now(),now(),now()
       )
       ON CONFLICT (reckoning_id, blueprint_id)
       DO UPDATE SET
         status = 'READY',
         generated_question = EXCLUDED.generated_question,
         attempt_count = reckoning_preparation_items.attempt_count + EXCLUDED.attempt_count,
         validation_issues = '[]'::jsonb,
         last_error = NULL,
         ready_at = COALESCE(reckoning_preparation_items.ready_at, now()),
         family_index = EXCLUDED.family_index,
         item_index = EXCLUDED.item_index,
         updated_at = now()
       RETURNING *`,
      [
        id,
        reckoningId,
        userId,
        String(blueprint.id),
        String(blueprint.evidenceId),
        Math.max(0, Number(familyIndex) || 0),
        Math.max(0, Number(itemIndex) || 0),
        json(question),
        Math.max(1, Number(generationAttempts) || 1),
      ]
    );
    await refreshPreparationProgress(reckoningId, userId);
    return rows?.[0] || null;
  }

  async function savePreparationItemFailure(reckoningId, userId, {
    blueprint,
    error,
    generationAttempts = 1,
    familyIndex = 0,
    itemIndex = 0,
  } = {}) {
    requireQuery();
    if (!blueprint?.id || !blueprint?.evidenceId) {
      throw new ReckoningContractError(
        'Preparation failure persistence requires blueprint metadata.'
      );
    }
    const id = randomUUID();
    const message = String(
      error?.message || error || 'Reckoning question generation failed'
    ).slice(0, 1500);
    const issues = Array.isArray(error?.validationIssues)
      ? error.validationIssues.filter(Boolean).slice(0, 25)
      : [];
    const { rows } = await query(
      `INSERT INTO reckoning_preparation_items (
         id, reckoning_id, user_id, blueprint_id, evidence_id,
         family_index, item_index, status, generated_question,
         attempt_count, validation_issues, last_error, ready_at,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'ERROR',NULL,
         $8,$9::jsonb,$10,NULL,now(),now()
       )
       ON CONFLICT (reckoning_id, blueprint_id)
       DO UPDATE SET
         status = CASE
           WHEN reckoning_preparation_items.status = 'READY' THEN 'READY'
           ELSE 'ERROR'
         END,
         generated_question = reckoning_preparation_items.generated_question,
         attempt_count = reckoning_preparation_items.attempt_count + EXCLUDED.attempt_count,
         validation_issues = CASE
           WHEN reckoning_preparation_items.status = 'READY'
             THEN reckoning_preparation_items.validation_issues
           ELSE EXCLUDED.validation_issues
         END,
         last_error = CASE
           WHEN reckoning_preparation_items.status = 'READY'
             THEN reckoning_preparation_items.last_error
           ELSE EXCLUDED.last_error
         END,
         family_index = EXCLUDED.family_index,
         item_index = EXCLUDED.item_index,
         updated_at = now()
       RETURNING *`,
      [
        id,
        reckoningId,
        userId,
        String(blueprint.id),
        String(blueprint.evidenceId),
        Math.max(0, Number(familyIndex) || 0),
        Math.max(0, Number(itemIndex) || 0),
        Math.max(1, Number(generationAttempts) || 1),
        json(issues),
        message,
      ]
    );
    await refreshPreparationProgress(reckoningId, userId, message);
    return rows?.[0] || null;
  }

  async function clearPreparationArtifacts(reckoningId, userId) {
    requireQuery();
    const { rowCount } = await query(
      `DELETE FROM reckoning_preparation_manifests
       WHERE reckoning_id = $1 AND user_id = $2`,
      [reckoningId, userId]
    );
    return Number(rowCount) > 0;
  }

  async function claimPreparation(reckoningId, userId, staleMinutes = 5) {
    requireQuery();
    const { rows } = await query(
      `UPDATE reckoning_sessions
       SET generation_status = 'pending',
           generation_error = NULL,
           engine_phase = 'PREPARING',
           questions_used = 0,
           current_block = 0,
           current_question_id = NULL,
           checkpoint_pending = false,
           checkpoint_next_question_id = NULL,
           raw_accuracy = NULL,
           recovery_score = NULL,
           unresolved_critical_count = 0,
           final_report = NULL,
           prepared_at = NULL,
           review_started_at = NULL,
           safety_expires_at = NULL,
           state_version = state_version + 1,
           updated_at = now()
       WHERE id = $1
         AND user_id = $2
         AND engine_version = 2
         AND engine_mode IN ('PILOT','LIVE')
         AND status IN ('triggered','deferred')
         AND exam_session_id IS NULL
         AND (deferred_until IS NULL OR deferred_until <= now())
         AND (
           generation_status IN ('not_started','error','partial')
           OR (
             generation_status = 'pending'
             AND updated_at < now() - ($3::text || ' minutes')::interval
           )
         )
       RETURNING *`,
      [reckoningId, userId, Math.max(1, Number(staleMinutes) || 5)]
    );
    return rows?.[0] || null;
  }

  async function touchPreparation(reckoningId, userId) {
    requireQuery();
    const { rows } = await query(
      `UPDATE reckoning_sessions
       SET updated_at = now()
       WHERE id = $1
         AND user_id = $2
         AND engine_version = 2
         AND engine_mode IN ('PILOT','LIVE')
         AND generation_status = 'pending'
         AND exam_session_id IS NULL
       RETURNING id, updated_at`,
      [reckoningId, userId]
    );
    return rows?.[0] || null;
  }

  async function releasePreparationFailure(reckoningId, userId, error) {
    requireQuery();
    const message = String(error?.message || error || 'Reckoning preparation failed').slice(0, 1500);
    const { rows } = await query(
      `UPDATE reckoning_sessions
       SET generation_status = 'error',
           generation_error = $3,
           engine_phase = 'PREPARING',
           updated_at = now()
       WHERE id = $1
         AND user_id = $2
         AND engine_version = 2
         AND exam_session_id IS NULL
       RETURNING *`,
      [reckoningId, userId, message]
    );
    return rows?.[0] || null;
  }

  async function clearPreparationEvidence(reckoningId, userId) {
    requireQuery();
    const { rows: sessions } = await query(
      `SELECT id
       FROM reckoning_sessions
       WHERE id = $1
         AND user_id = $2
         AND exam_session_id IS NULL
         AND questions_used = 0
       LIMIT 1`,
      [reckoningId, userId]
    );
    if (!sessions?.[0]) {
      throw new ReckoningContractError(
        'Preparation artifacts can only be cleared before a Reckoning exam is linked.'
      );
    }
    await query(
      'DELETE FROM reckoning_evidence WHERE reckoning_id = $1 AND user_id = $2',
      [reckoningId, userId]
    );
    return true;
  }

  async function createExecutionExam(userId, {
    id = randomUUID(),
    subjectId,
    deckIds = [],
    questionCount = 0,
    safetyWindowSeconds = 2700,
  } = {}) {
    requireQuery();
    const { rows } = await query(
      `INSERT INTO exam_sessions (
         id, user_id, subject_id, deck_ids, question_count, card_range,
         time_limit_seconds, is_reckoning, status, started_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4::jsonb,$5,'all',$6,true,'active',now(),now(),now()
       )
       RETURNING *`,
      [
        id,
        userId,
        subjectId || null,
        json(deckIds || []),
        Math.max(0, Number(questionCount) || 0),
        Math.max(60, Number(safetyWindowSeconds) || 2700),
      ]
    );
    return rows?.[0] || null;
  }

  async function createPreparedQuestion(userId, examSessionId, record = {}) {
    requireQuery();
    const id = record.id || randomUUID();
    const options = Array.isArray(record.options) ? record.options : [];
    const { rows } = await query(
      `INSERT INTO exam_questions (
         id, user_id, exam_session_id, card_id, question_number,
         cognitive_level, difficulty, question_type, stem,
         option_a, option_b, option_c, option_d, correct_answer, explanation,
         reckoning_evidence_id, reckoning_role, variant_index,
         reckoning_blueprint, is_unlocked, unlocked_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,
         $10,$11,$12,$13,$14,$15,
         $16,$17,$18,$19::jsonb,$20,$21,now(),now()
       )
       RETURNING *`,
      [
        id,
        userId,
        examSessionId,
        record.cardId || null,
        Number(record.questionNumber) || null,
        record.cognitiveLevel || null,
        record.difficulty || null,
        record.questionType || 'Reckoning',
        record.stem || '',
        options[0] || '',
        options[1] || '',
        options[2] || '',
        options[3] || '',
        record.correctAnswer || null,
        record.explanation || '',
        record.evidenceId || null,
        record.role || null,
        Number(record.variantIndex) || 0,
        json(record.blueprint || {}),
        Boolean(record.isUnlocked),
        record.isUnlocked ? (record.unlockedAt || new Date()) : null,
      ]
    );
    return rows?.[0] || null;
  }

  async function activatePreparedSession(reckoningId, userId, {
    examSessionId,
    currentQuestionId,
    questionCount,
    softQuestionBudget,
    hardQuestionCap,
    plannerVersion,
    configVersion,
    safetyWindowMinutes = 45,
  } = {}) {
    requireQuery();
    const { rows } = await query(
      `UPDATE reckoning_sessions
       SET status = 'in_progress',
           exam_session_id = $3,
           deferred_until = NULL,
           engine_version = 2,
           engine_mode = CASE
             WHEN engine_mode = 'PILOT' THEN 'PILOT'
             ELSE 'LIVE'
           END,
           engine_phase = 'ACTIVE',
           generation_status = 'ready',
           generation_error = NULL,
           question_count = $4,
           questions_used = 0,
           soft_question_budget = $5,
           hard_question_cap = $6,
           current_block = 1,
           current_question_id = $7,
           checkpoint_pending = false,
           checkpoint_next_question_id = NULL,
           prepared_at = now(),
           review_started_at = now(),
           safety_expires_at = now() + ($8::text || ' minutes')::interval,
           planner_version = $9,
           config_version = $10,
           state_version = state_version + 1,
           score_pct = NULL,
           raw_accuracy = NULL,
           recovery_score = NULL,
           unresolved_critical_count = 0,
           debrief_text = NULL,
           final_report = NULL,
           completed_at = NULL,
           updated_at = now()
       WHERE id = $1
         AND user_id = $2
         AND engine_version = 2
         AND engine_mode IN ('PILOT','LIVE')
         AND generation_status = 'pending'
         AND status IN ('triggered','deferred')
         AND exam_session_id IS NULL
         AND (deferred_until IS NULL OR deferred_until <= now())
       RETURNING *`,
      [
        reckoningId,
        userId,
        examSessionId,
        Math.max(1, Number(questionCount) || 1),
        Math.max(1, Number(softQuestionBudget) || 1),
        Math.max(1, Number(hardQuestionCap) || 30),
        currentQuestionId,
        Math.max(1, Number(safetyWindowMinutes) || 45),
        Number(plannerVersion) || 1,
        Number(configVersion) || 1,
      ]
    );
    return rows?.[0] || null;
  }

  async function invalidateExecutionQuestion(
    userId,
    examSessionId,
    questionId,
    audit = {}
  ) {
    requireQuery();
    const { rows } = await query(
      `UPDATE exam_questions
       SET is_unlocked = false,
           evidence_effect = COALESCE(evidence_effect, '{}'::jsonb)
             || $4::jsonb,
           updated_at = now()
       WHERE id = $1
         AND exam_session_id = $2
         AND user_id = $3
       RETURNING *`,
      [
        questionId,
        examSessionId,
        userId,
        json({ invalidated: true, audit }),
      ]
    );
    return rows?.[0] || null;
  }

  async function getSessionByExam(examSessionId, userId, { forUpdate = false } = {}) {
    requireQuery();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await query(
      `SELECT *
       FROM reckoning_sessions
       WHERE user_id = $2
         AND (
           exam_session_id = $1
           OR (
             engine_version = 2
             AND engine_phase IN ('FINALIZING','COMPLETE')
             AND last_failure_exam_id = $1
           )
         )
       LIMIT 1${suffix}`,
      [examSessionId, userId]
    );
    return rows?.[0] || null;
  }

  async function getEvidenceById(evidenceId, reckoningId, { forUpdate = false } = {}) {
    requireQuery();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await query(
      `SELECT *
       FROM reckoning_evidence
       WHERE id = $1 AND reckoning_id = $2
       LIMIT 1${suffix}`,
      [evidenceId, reckoningId]
    );
    return rows?.[0] || null;
  }

  async function getExecutionQuestions(examSessionId, { forUpdate = false } = {}) {
    requireQuery();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await query(
      `SELECT *
       FROM exam_questions
       WHERE exam_session_id = $1
         AND reckoning_evidence_id IS NOT NULL
       ORDER BY question_number ASC, variant_index ASC NULLS FIRST, id ASC${suffix}`,
      [examSessionId]
    );
    return rows || [];
  }

  async function getQuestionForExecution(
    userId,
    examSessionId,
    questionId,
    { forUpdate = false } = {}
  ) {
    requireQuery();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await query(
      `SELECT *
       FROM exam_questions
       WHERE id = $1
         AND exam_session_id = $2
         AND user_id = $3
         AND reckoning_evidence_id IS NOT NULL
       LIMIT 1${suffix}`,
      [questionId, examSessionId, userId]
    );
    return rows?.[0] || null;
  }

  async function saveQuestionAnswer(userId, examSessionId, questionId, {
    selectedOption,
    isCorrect,
    responseTimeMs,
    evidenceEffect,
  }) {
    requireQuery();
    const { rows } = await query(
      `UPDATE exam_questions
       SET selected_option = $4,
           is_correct = $5,
           response_time_ms = $6,
           time_spent_seconds = GREATEST(0, FLOOR($6::numeric / 1000))::integer,
           evidence_effect = $7::jsonb,
           updated_at = now()
       WHERE id = $1
         AND exam_session_id = $2
         AND user_id = $3
       RETURNING *`,
      [
        questionId,
        examSessionId,
        userId,
        selectedOption,
        Boolean(isCorrect),
        Math.max(0, Number(responseTimeMs) || 0),
        json(evidenceEffect || {}),
      ]
    );
    return rows?.[0] || null;
  }

  async function unlockQuestion(userId, examSessionId, questionId) {
    requireQuery();
    const { rows } = await query(
      `UPDATE exam_questions
       SET is_unlocked = true,
           unlocked_at = COALESCE(unlocked_at, now()),
           updated_at = now()
       WHERE id = $1
         AND exam_session_id = $2
         AND user_id = $3
         AND selected_option IS NULL
       RETURNING *`,
      [questionId, examSessionId, userId]
    );
    return rows?.[0] || null;
  }

  async function getCardForLearningEffect(
    userId,
    cardId,
    { forUpdate = false } = {}
  ) {
    requireQuery();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await query(
      `SELECT *
       FROM cards
       WHERE id = $1 AND user_id = $2
       LIMIT 1${suffix}`,
      [cardId, userId]
    );
    return rows?.[0] || null;
  }

  async function getCardStateForLearningEffect(
    userId,
    cardId,
    { forUpdate = false } = {}
  ) {
    requireQuery();
    const suffix = forUpdate ? ' FOR UPDATE' : '';
    const { rows } = await query(
      `SELECT *
       FROM card_states
       WHERE user_id = $1 AND card_id = $2
       LIMIT 1${suffix}`,
      [userId, cardId]
    );
    return rows?.[0] || null;
  }

  async function saveCardLearningEffect(userId, cardId, patch = {}) {
    requireQuery();
    const fieldMap = {
      stage: 'stage',
      intervalDays: 'interval_days',
      repetitionCount: 'repetition_count',
      nextReviewAt: 'next_review_at',
    };
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (!entries.length) return getCardForLearningEffect(userId, cardId);

    const values = [cardId, userId];
    const assignments = entries.map(([key, value]) => {
      const column = fieldMap[key];
      if (!column) {
        throw new ReckoningContractError(`Unsupported cards learning-effect field: ${key}`);
      }
      values.push(value);
      return `${column} = ${values.length}`;
    });

    const { rows } = await query(
      `UPDATE cards
       SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      values
    );
    return rows?.[0] || null;
  }

  async function saveCardStateLearningEffect({
    userId,
    card,
    evidence,
    patch = {},
  } = {}) {
    requireQuery();
    if (!userId || !card?.id) {
      throw new ReckoningContractError(
        'saveCardStateLearningEffect requires userId and card.'
      );
    }

    const current = await getCardStateForLearningEffect(userId, card.id);
    const state = patch.state ?? current?.state ?? 'GROWING';
    const stage = Number(patch.stage ?? current?.stage ?? card.stage) || 1;
    const verified = patch.verified ?? current?.verified ?? false;
    const verifiedAt = patch.verifiedAt !== undefined
      ? patch.verifiedAt
      : current?.verified_at ?? null;
    const lastEvaluatedAt = patch.lastEvaluatedAt ?? new Date();

    if (current) {
      const { rows } = await query(
        `UPDATE card_states
         SET state = $3,
             stage = $4,
             verified = $5,
             verified_at = $6,
             last_evaluated_at = $7,
             updated_at = now()
         WHERE user_id = $1 AND card_id = $2
         RETURNING *`,
        [
          userId,
          card.id,
          state,
          stage,
          Boolean(verified),
          verifiedAt,
          lastEvaluatedAt,
        ]
      );
      return rows?.[0] || null;
    }

    const id = `${userId}_${card.id}`;
    const { rows } = await query(
      `INSERT INTO card_states (
         id, user_id, card_id, state, stage, deck_id, subject_id,
         verified, verified_at, last_evaluated_at, bubble_ids,
         learning_debt, cross_bubble, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,false,false,now(),now()
       )
       ON CONFLICT (id) DO UPDATE SET
         state = EXCLUDED.state,
         stage = EXCLUDED.stage,
         verified = EXCLUDED.verified,
         verified_at = EXCLUDED.verified_at,
         last_evaluated_at = EXCLUDED.last_evaluated_at,
         updated_at = now()
       RETURNING *`,
      [
        id,
        userId,
        card.id,
        state,
        stage,
        card.deck_id || null,
        evidence?.subject_id || null,
        Boolean(verified),
        verifiedAt,
        lastEvaluatedAt,
      ]
    );
    return rows?.[0] || null;
  }

  async function completeExecutionExam(userId, examSessionId, {
    rawAccuracy,
    answeredCount,
    correctCount,
  } = {}) {
    requireQuery();
    const { rows } = await query(
      `UPDATE exam_sessions
       SET status = 'completed',
           score_pct = $3,
           correct_answers = $4,
           total_questions = $5,
           completed_at = COALESCE(completed_at, now()),
           duration_seconds = CASE
             WHEN COALESCE(duration_seconds, 0) > 0 THEN duration_seconds
             ELSE GREATEST(
               0,
               FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(started_at, now()))))
             )::integer
           END,
           timed_out = false,
           ended_early = false,
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        examSessionId,
        userId,
        Number(rawAccuracy) || 0,
        Math.max(0, Number(correctCount) || 0),
        Math.max(0, Number(answeredCount) || 0),
      ]
    );
    return rows?.[0] || null;
  }

  async function saveSession(reckoningId, patch) {
    requireQuery();
    const statement = createPatchQuery({
      table: 'reckoning_sessions',
      id: reckoningId,
      patch,
      fieldMap: SESSION_FIELD_MAP,
      jsonFields: JSON_SESSION_FIELDS,
    });
    const { rows } = await query(statement.sql, statement.values);
    return rows?.[0] || null;
  }

  async function saveEvidence(evidenceId, patch) {
    requireQuery();
    const statement = createPatchQuery({
      table: 'reckoning_evidence',
      id: evidenceId,
      patch,
      fieldMap: EVIDENCE_FIELD_MAP,
      jsonFields: JSON_EVIDENCE_FIELDS,
    });
    const { rows } = await query(statement.sql, statement.values);
    return rows?.[0] || null;
  }

  async function withOutcomeLock(reckoningId, work) {
    if (!reckoningId || typeof work !== 'function') {
      throw new ReckoningContractError(
        'withOutcomeLock requires reckoningId and a function.'
      );
    }
    if (typeof transaction !== 'function') {
      throw new ReckoningContractError(
        'Reckoning store requires a transaction function for outcome locking.'
      );
    }

    // The lock is transaction-scoped, so normal completion, thrown errors and
    // process/connection loss all release it automatically. It intentionally
    // spans outcome work that uses other pooled connections.
    return transaction(async (client) => {
      if (!client || typeof client.query !== 'function') {
        throw new ReckoningContractError(
          'Outcome lock requires a transactional PostgreSQL client.'
        );
      }
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
        [`reckoning-v2-outcome:${reckoningId}`]
      );
      return work();
    });
  }

  async function withTransaction(work) {
    if (typeof work !== 'function') {
      throw new ReckoningContractError('withTransaction requires a function.');
    }
    if (typeof transaction !== 'function') {
      throw new ReckoningContractError(
        'Reckoning store requires a transaction function for transactional work.'
      );
    }

    return transaction(async (client) => {
      const transactionQuery =
        client && typeof client.query === 'function'
          ? client.query.bind(client)
          : query;
      const transactionStore = createReckoningStore({
        query: transactionQuery,
        randomUUID,
      });
      return work(transactionStore, client);
    });
  }

  return Object.freeze({
    name: 'reckoning-postgres-store',
    getSession,
    getPreparationManifest,
    createPreparationManifest,
    getPreparationItems,
    refreshPreparationProgress,
    savePreparationItemReady,
    savePreparationItemFailure,
    clearPreparationArtifacts,
    claimPreparation,
    touchPreparation,
    releasePreparationFailure,
    clearPreparationEvidence,
    createExecutionExam,
    createPreparedQuestion,
    activatePreparedSession,
    invalidateExecutionQuestion,
    getSessionByExam,
    getEvidence,
    getEvidenceById,
    getExecutionQuestions,
    getQuestionForExecution,
    getCardForLearningEffect,
    getCardStateForLearningEffect,
    createEvidence,
    upsertEvidence,
    saveSession,
    saveEvidence,
    saveQuestionAnswer,
    saveCardLearningEffect,
    saveCardStateLearningEffect,
    completeExecutionExam,
    unlockQuestion,
    withOutcomeLock,
    withTransaction,
  });
}

module.exports = {
  SESSION_FIELD_MAP,
  EVIDENCE_FIELD_MAP,
  JSON_SESSION_FIELDS,
  createPatchQuery,
  createReckoningStore,
};