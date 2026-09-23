'use strict';

const { RECKONING_ENGINE, SESSION_PHASES } = require('./constants');
const { createReckoningConfig } = require('./config');
const { notImplemented, ReckoningContractError } = require('./errors');
const { assertEngineContract } = require('./contracts');
const { createReckoningStore } = require('./store');
const { createEvidenceEngine } = require('./evidence');
const { createScheduler } = require('./scheduler');
const { createScoringEngine } = require('./scoring');
const { createStateMachine } = require('./state-machine');

function field(row, camel, snake, fallback = null) {
  if (row?.[camel] !== undefined) return row[camel];
  if (row?.[snake] !== undefined) return row[snake];
  return fallback;
}

function adaptiveSessionAllowed(session) {
  const version = Number(field(session, 'engineVersion', 'engine_version', 1)) || 1;
  const mode = String(field(session, 'engineMode', 'engine_mode', 'LEGACY'));
  return version === 2 && ['PILOT', 'LIVE'].includes(mode);
}

function requireAdaptiveSession(session) {
  if (!session) {
    const error = new ReckoningContractError('Reckoning session not found for this exam.');
    error.status = 404;
    throw error;
  }
  if (!adaptiveSessionAllowed(session)) {
    const error = new ReckoningContractError(
      'Adaptive Reckoning execution is not active for this session.'
    );
    error.code = 'ERR_RECKONING_V2_NOT_ACTIVE';
    error.status = 409;
    throw error;
  }
  return session;
}

function sanitizeCurrentQuestion(question) {
  if (!question) return null;
  return Object.freeze({
    id: question.id,
    questionNumber: question.question_number,
    role: question.reckoning_role,
    variantIndex: question.variant_index,
    cognitiveLevel: question.cognitive_level,
    difficulty: question.difficulty,
    stem: question.stem,
    options: Object.freeze([
      Object.freeze({ id: 'A', text: question.option_a || '' }),
      Object.freeze({ id: 'B', text: question.option_b || '' }),
      Object.freeze({ id: 'C', text: question.option_c || '' }),
      Object.freeze({ id: 'D', text: question.option_d || '' }),
    ]),
    unlockedAt: question.unlocked_at || null,
  });
}

function sanitizeHistoryQuestion(question) {
  return Object.freeze({
    id: question.id,
    questionNumber: question.question_number,
    role: question.reckoning_role,
    variantIndex: question.variant_index,
    stem: question.stem,
    selectedOption: question.selected_option,
    isCorrect: question.is_correct === true,
    responseTimeMs: Number(question.response_time_ms) || 0,
    correctAnswer: question.correct_answer || null,
    explanation: question.explanation || '',
    evidenceEffect: question.evidence_effect || null,
  });
}

function evidenceSummary(row) {
  return Object.freeze({
    id: row.id,
    sourceCardId: row.source_card_id,
    conceptKey: row.concept_key,
    riskScore: Number(row.risk_score) || 0,
    riskLevel: row.risk_level,
    status: row.evidence_status,
    diagnosticOutcome: row.diagnostic_outcome,
    challengeOutcome: row.challenge_outcome,
    confirmationOutcome: row.confirmation_outcome,
    successfulDemonstrations: Number(row.successful_demonstrations) || 0,
    requiredConfirmations: Number(row.required_confirmations) || 0,
    questionsSeen: Number(row.questions_seen) || 0,
    discoveredByControl: row.discovered_by_control === true,
    nextEligibleQuestion: row.next_eligible_question == null
      ? null
      : Number(row.next_eligible_question),
  });
}

function createReckoningEngine(options = {}) {
  const config = createReckoningConfig(options.config);
  const store = options.store || createReckoningStore({
    query: options.query,
    transaction: options.transaction,
    randomUUID: options.randomUUID,
  });
  const evidenceEngine = options.evidenceEngine || createEvidenceEngine({ config });
  const scheduler = options.scheduler || createScheduler({ config });
  const scoring = options.scoringEngine || createScoringEngine({ config });
  const stateMachine = options.stateMachine || createStateMachine();

  async function buildState(activeStore, {
    examSessionId,
    userId,
    session: providedSession = null,
  }) {
    const session = requireAdaptiveSession(
      providedSession || await activeStore.getSessionByExam(examSessionId, userId)
    );
    const [evidence, questions] = await Promise.all([
      activeStore.getEvidence(session.id),
      activeStore.getExecutionQuestions(examSessionId),
    ]);

    const questionsUsed = Number(session.questions_used) || 0;
    const score = scoring.calculateRecovery({
      evidence,
      questions,
      questionsUsed,
    });
    const evidenceState = evidenceEngine.evaluate(evidence);
    const currentQuestionId = session.current_question_id;
    const currentQuestion = currentQuestionId
      ? questions.find(
          (question) =>
            String(question.id) === String(currentQuestionId) &&
            question.selected_option == null &&
            question.is_unlocked === true
        ) || null
      : null;
    const history = questions
      .filter((question) => question.selected_option != null)
      .map(sanitizeHistoryQuestion);

    const phase = session.engine_phase || SESSION_PHASES.ACTIVE;
    const blockSize = config.execution.blockSize;
    const checkpointDue =
      phase === SESSION_PHASES.ACTIVE &&
      questionsUsed > 0 &&
      questionsUsed % blockSize === 0 &&
      Boolean(currentQuestion);

    return Object.freeze({
      reckoningId: session.id,
      examSessionId,
      engineVersion: Number(session.engine_version) || 2,
      engineMode: session.engine_mode,
      enginePhase: phase,
      reviewRole: currentQuestion?.reckoning_role || null,
      questionsUsed,
      softQuestionBudget: Number(session.soft_question_budget) || null,
      hardQuestionCap: Number(session.hard_question_cap) || config.planner.hardQuestionCap,
      currentBlock: Number(session.current_block) || 0,
      stateVersion: Number(session.state_version) || 0,
      safetyExpiresAt: session.safety_expires_at || null,
      checkpointDue,
      currentQuestion: sanitizeCurrentQuestion(currentQuestion),
      history: Object.freeze(history),
      evidence: Object.freeze(evidence.map(evidenceSummary)),
      evidenceState,
      recovery: score,
      final:
        phase === SESSION_PHASES.FINALIZING ||
        phase === SESSION_PHASES.COMPLETE,
    });
  }

  async function getState({ examSessionId, userId } = {}) {
    if (!examSessionId || !userId) {
      throw new ReckoningContractError('getState requires examSessionId and userId.');
    }
    return buildState(store, { examSessionId, userId });
  }

  async function recordAnswer({
    examSessionId,
    userId,
    questionId,
    selectedOption,
    responseTimeMs = 0,
  } = {}) {
    const selected = String(selectedOption || '').toUpperCase();
    if (!examSessionId || !userId || !questionId) {
      throw new ReckoningContractError(
        'recordAnswer requires examSessionId, userId and questionId.'
      );
    }
    if (!/^[A-D]$/.test(selected)) {
      throw new ReckoningContractError('selectedOption must be A, B, C or D.');
    }

    return store.withTransaction(async (txStore) => {
      const session = requireAdaptiveSession(
        await txStore.getSessionByExam(examSessionId, userId, { forUpdate: true })
      );

      if (![SESSION_PHASES.ACTIVE, SESSION_PHASES.FINALIZING].includes(session.engine_phase)) {
        const error = new ReckoningContractError(
          `Adaptive Reckoning is not answerable in phase ${session.engine_phase || 'UNKNOWN'}.`
        );
        error.status = 409;
        throw error;
      }

      const question = await txStore.getQuestionForExecution(
        userId,
        examSessionId,
        questionId,
        { forUpdate: true }
      );
      if (!question) {
        const error = new ReckoningContractError('Reckoning question not found.');
        error.status = 404;
        throw error;
      }

      // Network retries and double taps return persisted state and never apply
      // evidence a second time.
      if (question.selected_option != null) {
        const state = await buildState(txStore, {
          examSessionId,
          userId,
          session,
        });
        return Object.freeze({ ...state, duplicate: true, feedback: null });
      }

      if (
        session.engine_phase !== SESSION_PHASES.ACTIVE ||
        question.is_unlocked !== true ||
        String(session.current_question_id || '') !== String(question.id)
      ) {
        const error = new ReckoningContractError(
          'Only the currently unlocked Reckoning question can be answered.'
        );
        error.code = 'ERR_RECKONING_QUESTION_LOCKED';
        error.status = 409;
        throw error;
      }

      const evidence = await txStore.getEvidenceById(
        question.reckoning_evidence_id,
        session.id,
        { forUpdate: true }
      );
      if (!evidence) {
        throw new ReckoningContractError('Question evidence record is missing.');
      }

      const isCorrect = selected === String(question.correct_answer || '').toUpperCase();
      const answeredOrdinal = (Number(session.questions_used) || 0) + 1;
      const transition = evidenceEngine.record(evidence, {
        role: question.reckoning_role,
        isCorrect,
        questionOrdinal: answeredOrdinal,
      });

      await txStore.saveEvidence(evidence.id, transition.patch);
      await txStore.saveQuestionAnswer(userId, examSessionId, question.id, {
        selectedOption: selected,
        isCorrect,
        responseTimeMs,
        evidenceEffect: {
          evidenceModelVersion: transition.evidenceModelVersion,
          role: transition.role,
          outcome: transition.outcome,
          patch: transition.patch,
        },
      });

      let evidenceRows = await txStore.getEvidence(session.id);
      let questions = await txStore.getExecutionQuestions(examSessionId);
      let recovery = scoring.calculateRecovery({
        evidence: evidenceRows,
        questions,
        questionsUsed: answeredOrdinal,
      });

      const hardCap = Number(session.hard_question_cap) || config.planner.hardQuestionCap;
      let next = recovery.survived
        ? { type: 'COMPLETE', reason: 'RECOVERY_SUFFICIENT' }
        : scheduler.chooseNext({
            evidence: evidenceRows,
            questions,
            questionsUsed: answeredOrdinal,
            lastEvidenceId: evidence.id,
          });

      if (answeredOrdinal >= hardCap) {
        next = { type: 'COMPLETE', reason: 'HARD_CAP_REACHED' };
      }

      const nextStateVersion = (Number(session.state_version) || 0) + 1;
      const baseSessionPatch = {
        questionsUsed: answeredOrdinal,
        rawAccuracy: recovery.rawAccuracy,
        recoveryScore: recovery.recoveryScore,
        unresolvedCriticalCount: recovery.unresolvedCriticalCount,
        stateVersion: nextStateVersion,
      };

      if (next.type === 'COMPLETE') {
        stateMachine.transition(SESSION_PHASES.ACTIVE, SESSION_PHASES.FINALIZING);
        await txStore.saveSession(session.id, {
          ...baseSessionPatch,
          enginePhase: SESSION_PHASES.FINALIZING,
          currentQuestionId: null,
          currentBlock: Math.ceil(answeredOrdinal / config.execution.blockSize),
        });
      } else {
        const unlocked = await txStore.unlockQuestion(
          userId,
          examSessionId,
          next.questionId
        );
        if (!unlocked) {
          throw new ReckoningContractError(
            'Scheduler selected a question that could not be unlocked.'
          );
        }
        await txStore.saveSession(session.id, {
          ...baseSessionPatch,
          enginePhase: SESSION_PHASES.ACTIVE,
          currentQuestionId: next.questionId,
          currentBlock:
            Math.floor(answeredOrdinal / config.execution.blockSize) + 1,
        });
      }

      const persistedSession = await txStore.getSessionByExam(
        examSessionId,
        userId
      );
      const state = await buildState(txStore, {
        examSessionId,
        userId,
        session: persistedSession,
      });

      return Object.freeze({
        ...state,
        duplicate: false,
        stopReason: next.type === 'COMPLETE' ? next.reason : null,
        scheduler: next.type === 'QUESTION'
          ? Object.freeze({
              role: next.role,
              nextOrdinal: next.nextOrdinal,
              spacingRelaxed: next.spacingRelaxed,
              controlDue: next.controlDue,
            })
          : null,
        feedback: Object.freeze({
          questionId: question.id,
          evidenceId: evidence.id,
          role: question.reckoning_role,
          selectedOption: selected,
          isCorrect,
          correctAnswer: isCorrect ? null : question.correct_answer,
          explanation: isCorrect ? '' : (question.explanation || ''),
        }),
      });
    });
  }

  async function finalize({ examSessionId, userId } = {}) {
    if (!examSessionId || !userId) {
      throw new ReckoningContractError('finalize requires examSessionId and userId.');
    }

    return store.withTransaction(async (txStore) => {
      const session = requireAdaptiveSession(
        await txStore.getSessionByExam(examSessionId, userId, { forUpdate: true })
      );
      const [evidence, questions] = await Promise.all([
        txStore.getEvidence(session.id),
        txStore.getExecutionQuestions(examSessionId),
      ]);
      const questionsUsed = Number(session.questions_used) || 0;
      const recovery = scoring.calculateRecovery({
        evidence,
        questions,
        questionsUsed,
      });
      const next = scheduler.chooseNext({
        evidence,
        questions,
        questionsUsed,
      });
      const hardCap = Number(session.hard_question_cap) || config.planner.hardQuestionCap;

      const finalizable =
        recovery.survived ||
        questionsUsed >= hardCap ||
        next.type === 'COMPLETE';

      if (!finalizable) {
        return Object.freeze({
          ready: false,
          recovery,
          reason: 'MORE_EVIDENCE_REQUIRED',
        });
      }

      if (session.engine_phase === SESSION_PHASES.ACTIVE) {
        stateMachine.transition(SESSION_PHASES.ACTIVE, SESSION_PHASES.FINALIZING);
      }
      await txStore.saveSession(session.id, {
        enginePhase: SESSION_PHASES.FINALIZING,
        currentQuestionId: null,
        rawAccuracy: recovery.rawAccuracy,
        recoveryScore: recovery.recoveryScore,
        unresolvedCriticalCount: recovery.unresolvedCriticalCount,
        stateVersion: (Number(session.state_version) || 0) + 1,
      });

      return Object.freeze({
        ready: true,
        recovery,
        reason: recovery.survived
          ? 'RECOVERY_SUFFICIENT'
          : questionsUsed >= hardCap
            ? 'HARD_CAP_REACHED'
            : 'NO_PENDING_QUESTIONS',
      });
    });
  }

  const engine = {
    describe() {
      return Object.freeze({
        name: RECKONING_ENGINE.NAME,
        engineVersion: config.engineVersion,
        architectureVersion: config.architectureVersion,
        status: RECKONING_ENGINE.STATUS,
        enabled: config.enabled,
        behaviorAuthority: config.behaviorAuthority,
        executionCore: true,
        evidenceModelVersion: config.evidenceModelVersion,
        schedulerVersion: config.schedulerVersion,
        scoringVersion: config.scoringVersion,
      });
    },
    prepare() { return notImplemented('engine.prepare'); },
    start() { return notImplemented('engine.start'); },
    recordAnswer,
    getState,
    finalize,
  };

  return Object.freeze(assertEngineContract(engine));
}

module.exports = {
  adaptiveSessionAllowed,
  sanitizeCurrentQuestion,
  sanitizeHistoryQuestion,
  createReckoningEngine,
};
