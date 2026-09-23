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

  async function getSession(reckoningId, userId = null) {
    requireQuery();
    const params = [reckoningId];
    let sql = 'SELECT * FROM reckoning_sessions WHERE id = $1';

    if (userId != null) {
      params.push(userId);
      sql += ' AND user_id = $2';
    }

    sql += ' LIMIT 1';
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
    return transaction(work);
  }

  return Object.freeze({
    name: 'reckoning-postgres-store',
    getSession,
    getEvidence,
    createEvidence,
    upsertEvidence,
    saveSession,
    saveEvidence,
    withTransaction,
  });
}

module.exports = {
  SESSION_FIELD_MAP,
  EVIDENCE_FIELD_MAP,
  createPatchQuery,
  createReckoningStore,
};