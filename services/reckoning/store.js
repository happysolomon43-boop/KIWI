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
           duration_seconds = COALESCE(
             duration_seconds,
             GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - started_at))))::integer
           ),
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
    withTransaction,
  });
}

module.exports = {
  SESSION_FIELD_MAP,
  EVIDENCE_FIELD_MAP,
  createPatchQuery,
  createReckoningStore,
};