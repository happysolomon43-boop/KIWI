'use strict';

const { RECKONING_ENGINE, SESSION_PHASES } = require('./constants');
const { createReckoningConfig } = require('./config');
const { notImplemented, ReckoningContractError } = require('./errors');
const { assertEngineContract } = require('./contracts');
const { createReckoningStore } = require('./store');
const { createEvidenceEngine } = require('./evidence');
const { createScheduler } = require('./scheduler');
const { createScoringEngine } = require('./scoring');
const { createLearningEffectsEngine } = require('./learning-effects');
const { createPreparationService } = require('./preparation');
const { createStateMachine } = require('./state-machine');

function field(row, camel, snake, fallback = null) {
  if (row?.[camel] !== undefined) return row[camel];
  if (row?.[snake] !== undefined) return row[snake];
  return fallback;
}

function isAdaptiveReckoningQuestion(question) {
  return Boolean(question?.reckoning_evidence_id);
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
    answered: question.selected_option != null,
    responseTimeMs: Number(question.response_time_ms) || 0,
  });
}

function evidenceConceptLabel(row) {
  const snapshot = row?.source_snapshot || row?.sourceSnapshot || {};
  return String(
    snapshot.front_content ||
    snapshot.front ||
    snapshot.question ||
    snapshot.title ||
    row?.concept_key ||
    'Study concept'
  ).slice(0, 180);
}

function evidenceSummary(row) {
  return Object.freeze({
    id: row.id,
    conceptLabel: evidenceConceptLabel(row),
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

function buildCheckpoint(evidence, questions, blockSize) {
  const answered = (questions || []).filter(
    (question) => question.selected_option != null
  );
  const recent = answered.slice(-Math.max(1, Number(blockSize) || 5));
  const missed = recent
    .filter(
      (question) =>
        question.is_correct === false &&
        question.bonus_awarded !== true &&
        question.evidence_effect?.invalidated !== true
    )
    .map((question) => Object.freeze({
      questionId: question.id,
      role: question.reckoning_role,
      stem: question.stem || '',
      explanation: question.explanation || '',
    }));

  const summaries = (evidence || []).map(evidenceSummary);
  return Object.freeze({
    recovered: summaries.filter((item) => item.status === 'RECOVERED').length,
    unresolved: summaries.filter((item) => item.status === 'UNRESOLVED').length,
    provisional: summaries.filter((item) =>
      ['PROVISIONAL','CONFIRMATION_REQUIRED'].includes(item.status)
    ).length,
    challengeRequired: summaries.filter(
      (item) => item.status === 'CHALLENGE_REQUIRED'
    ).length,
    missed: Object.freeze(missed),
  });
}

function buildFinalReport({
  evidence = [],
  recovery = {},
  evidenceState = {},
  learningEffects = {},
  outcome = null,
  reason = null,
} = {}) {
  const summaries = evidence.map(evidenceSummary);
  const recovered = summaries.filter((item) => item.status === 'RECOVERED');
  const unresolved = summaries.filter((item) =>
    item.status === 'UNRESOLVED' ||
    (
      item.riskLevel === 'CRITICAL' &&
      item.status !== 'RECOVERED' &&
      item.status !== 'INVALIDATED'
    )
  );
  const discovered = summaries.filter((item) => item.discoveredByControl);
  const effects = Array.isArray(learningEffects?.applied)
    ? learningEffects.applied.map((effect) => Object.freeze({
        sourceCardId: effect.sourceCardId || null,
        type: effect.type || null,
        stageBefore: effect.stageBefore ?? null,
        stageAfter: effect.stageAfter ?? null,
        reviewAt: effect.reviewAt || effect.cardPatch?.nextReviewAt || null,
        verificationRevoked: effect.verificationRevoked === true,
      }))
    : [];

  return Object.freeze({
    survived: recovery.survived === true,
    stopReason: reason || null,
    rawAccuracy: Number(recovery.rawAccuracy) || 0,
    recoveryScore: Number(recovery.recoveryScore) || 0,
    allCriticalRecovered: recovery.allCriticalRecovered === true,
    unresolvedCriticalCount: Number(recovery.unresolvedCriticalCount) || 0,
    recovered: Object.freeze(recovered),
    unresolved: Object.freeze(unresolved),
    discoveredByControl: Object.freeze(discovered),
    evidenceState: Object.freeze({ ...(evidenceState || {}) }),
    learningEffects: Object.freeze(effects),
    consequenceSummary: Object.freeze({
      ...(learningEffects?.summary || outcome?.consequence_summary || {}),
    }),
    knowledgeScore: outcome?.knowledge_score || null,
    reckoning: outcome?.reckoning || null,
  });
}

function isSafetyExpired(session, nowMs = Date.now()) {
  if (!session?.safety_expires_at) return false;
  const expires = new Date(session.safety_expires_at).getTime();
  return Number.isFinite(expires) && expires <= nowMs;
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
  const learningEffects =
    options.learningEffectsEngine || createLearningEffectsEngine({ config });
  const stateMachine = options.stateMachine || createStateMachine();
  const outcomeHandler = options.outcomeHandler || null;
  const preparationInputProvider = options.preparationInputProvider || null;
  const preparationService =
    options.preparationService ||
    createPreparationService({
      config,
      questionBank: options.questionBank,
      randomUUID: options.randomUUID,
    });
  const clock = options.clock || (() => new Date());

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
    const checkpointPending = session.checkpoint_pending === true;
    const reviewStartedAt = session.review_started_at
      ? new Date(session.review_started_at).getTime()
      : null;
    const elapsedSeconds = Number.isFinite(reviewStartedAt)
      ? Math.max(0, Math.floor((Date.now() - reviewStartedAt) / 1000))
      : 0;
    const checkpoint = checkpointPending
      ? Object.freeze({
          ...buildCheckpoint(evidence, questions, config.execution.blockSize),
          criticalUnresolved: evidenceState.criticalUnresolved,
          message:
            evidenceState.criticalUnresolved > 0
              ? `${evidenceState.recovered} concepts recovered. ${evidenceState.criticalUnresolved} Critical concept${evidenceState.criticalUnresolved === 1 ? '' : 's'} still need recovery.`
              : `${evidenceState.recovered} concepts recovered. ${evidenceState.unresolved} unresolved.`,
        })
      : null;

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
      safetyExpired: isSafetyExpired(session),
      elapsedSeconds,
      checkpointPending,
      checkpoint,
      currentQuestion: sanitizeCurrentQuestion(currentQuestion),
      history: Object.freeze(history),
      evidence: Object.freeze(evidence.map(evidenceSummary)),
      evidenceState,
      recovery: score,
      finalReport: session.final_report || null,
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

  async function prepare({ reckoningId, userId } = {}) {
    if (!reckoningId || !userId) {
      throw new ReckoningContractError('prepare requires reckoningId and userId.');
    }
    if (!preparationService || typeof preparationInputProvider !== 'function') {
      const error = new ReckoningContractError(
        'Adaptive Reckoning preparation is not configured.'
      );
      error.code = 'ERR_RECKONING_PREPARATION_UNAVAILABLE';
      error.status = 503;
      throw error;
    }

    const claimed = await store.claimPreparation(
      reckoningId,
      userId,
      config.preparation.claimStaleMinutes
    );
    if (!claimed) {
      const current = await store.getSession(reckoningId, userId);
      if (
        current &&
        current.engine_version === 2 &&
        ['PILOT', 'LIVE'].includes(String(current.engine_mode || '')) &&
        current.status === 'in_progress' &&
        current.exam_session_id
      ) {
        return buildState(store, {
          examSessionId: current.exam_session_id,
          userId,
          session: current,
        });
      }
      const error = new ReckoningContractError(
        current?.generation_status === 'pending'
          ? 'Reckoning preparation is already in progress.'
          : 'Reckoning is not ready for adaptive preparation.'
      );
      error.code = current?.generation_status === 'pending'
        ? 'ERR_RECKONING_PREPARING'
        : 'ERR_RECKONING_PREPARE_STATE';
      error.status = 409;
      throw error;
    }

    try {
      const input = await preparationInputProvider({
        session: claimed,
        userId,
      });
      const prepared = await preparationService.prepare({
        ...input,
        context: {
          ...(input?.context || {}),
          subjectId: claimed.subject_id,
          pressureScore: Number(claimed.pressure_score) || 0,
        },
        generationGroupId: claimed.id,
      });

      const activated = await store.withTransaction(async (txStore) => {
        const locked = await txStore.getSession(claimed.id, userId, { forUpdate: true });
        if (!locked || locked.exam_session_id || locked.status === 'completed') {
          throw new ReckoningContractError(
            'Reckoning changed while preparation was running.'
          );
        }

        await txStore.clearPreparationEvidence(claimed.id, userId);
        for (const evidence of prepared.plan.evidence) {
          await txStore.createEvidence({
            id: evidence.id,
            reckoningId: claimed.id,
            userId,
            subjectId: claimed.subject_id,
            sourceCardId: evidence.sourceCardId,
            conceptKey: evidence.conceptKey,
            sourceSnapshot: evidence.sourceSnapshot,
            sourceHash: evidence.sourceHash,
            originalCardState: evidence.originalCardState,
            riskScore: evidence.riskScore,
            riskLevel: evidence.riskLevel,
            riskReasons: evidence.riskReasons,
            isBubbleCritical: evidence.isBubbleCritical,
            hasLearningDebt: evidence.hasLearningDebt,
            discoveredByControl: false,
            evidenceStatus: 'UNTESTED',
            requiredConfirmations: evidence.requiredConfirmations,
          });
        }

        const exam = await txStore.createExecutionExam(userId, {
          subjectId: claimed.subject_id,
          deckIds: input?.deckIds || [],
          questionCount: prepared.questions.length,
          safetyWindowSeconds: config.execution.safetyWindowMinutes * 60,
        });
        if (!exam) throw new ReckoningContractError('Failed to create adaptive Reckoning exam.');

        const inserted = [];
        for (const question of prepared.questions) {
          inserted.push(await txStore.createPreparedQuestion(
            userId,
            exam.id,
            question
          ));
        }
        const firstQuestion =
          inserted.find((row) => String(row.id) === String(prepared.firstQuestionId)) ||
          inserted.find(
            (row) => Number(row.question_number) === Number(prepared.firstQuestionNumber)
          ) ||
          inserted[0];
        if (!firstQuestion) {
          throw new ReckoningContractError('Adaptive Reckoning bank has no initial question.');
        }
        await txStore.unlockQuestion(userId, exam.id, firstQuestion.id);

        const session = await txStore.activatePreparedSession(claimed.id, userId, {
          examSessionId: exam.id,
          currentQuestionId: firstQuestion.id,
          questionCount: inserted.length,
          softQuestionBudget: prepared.plan.softQuestionBudget,
          hardQuestionCap: prepared.plan.hardQuestionCap,
          plannerVersion: prepared.plan.plannerVersion,
          configVersion: config.configVersion,
          safetyWindowMinutes: config.execution.safetyWindowMinutes,
        });
        if (!session) {
          throw new ReckoningContractError('Failed to activate prepared Reckoning session.');
        }
        return { exam, session };
      });

      return buildState(store, {
        examSessionId: activated.exam.id,
        userId,
        session: activated.session,
      });
    } catch (error) {
      await store.releasePreparationFailure(reckoningId, userId, error).catch(() => null);
      throw error;
    }
  }

  async function start({ reckoningId, userId } = {}) {
    const session = await store.getSession(reckoningId, userId);
    if (
      session?.status === 'in_progress' &&
      session.exam_session_id &&
      adaptiveSessionAllowed(session)
    ) {
      return buildState(store, {
        examSessionId: session.exam_session_id,
        userId,
        session,
      });
    }
    return prepare({ reckoningId, userId });
  }

  async function continueCheckpoint({ examSessionId, userId } = {}) {
    return store.withTransaction(async (txStore) => {
      const session = requireAdaptiveSession(
        await txStore.getSessionByExam(examSessionId, userId, { forUpdate: true })
      );
      if (!session.checkpoint_pending || !session.checkpoint_next_question_id) {
        return buildState(txStore, { examSessionId, userId, session });
      }
      const unlocked = await txStore.unlockQuestion(
        userId,
        examSessionId,
        session.checkpoint_next_question_id
      );
      if (!unlocked) {
        throw new ReckoningContractError('Checkpoint next question could not be unlocked.');
      }
      const updated = await txStore.saveSession(session.id, {
        checkpointPending: false,
        checkpointNextQuestionId: null,
        currentQuestionId: session.checkpoint_next_question_id,
        currentBlock: (Number(session.current_block) || 1) + 1,
        stateVersion: (Number(session.state_version) || 0) + 1,
      });
      return buildState(txStore, { examSessionId, userId, session: updated });
    });
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
          checkpointPending: false,
          checkpointNextQuestionId: null,
          currentBlock: Math.ceil(answeredOrdinal / config.execution.blockSize),
        });
      } else {
        const checkpointPending =
          answeredOrdinal > 0 &&
          answeredOrdinal % config.execution.blockSize === 0;
        if (checkpointPending) {
          await txStore.saveSession(session.id, {
            ...baseSessionPatch,
            enginePhase: SESSION_PHASES.ACTIVE,
            currentQuestionId: null,
            checkpointPending: true,
            checkpointNextQuestionId: next.questionId,
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
            checkpointPending: false,
            checkpointNextQuestionId: null,
            currentBlock:
              Math.floor(answeredOrdinal / config.execution.blockSize) + 1,
          });
        }
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
          recorded: true,
        }),
      });
    });
  }

  async function finalize({ examSessionId, userId } = {}) {
    if (!examSessionId || !userId) {
      throw new ReckoningContractError('finalize requires examSessionId and userId.');
    }

    const prepared = await store.withTransaction(async (txStore) => {
      const session = requireAdaptiveSession(
        await txStore.getSessionByExam(examSessionId, userId, { forUpdate: true })
      );

      if (session.engine_phase === SESSION_PHASES.COMPLETE) {
        const [evidence, questions] = await Promise.all([
          txStore.getEvidence(session.id),
          txStore.getExecutionQuestions(examSessionId),
        ]);
        return Object.freeze({
          ready: true,
          alreadyFinalized: true,
          session,
          evidence,
          questions,
          recovery: scoring.calculateRecovery({
            evidence,
            questions,
            questionsUsed: Number(session.questions_used) || 0,
          }),
          learningEffects: Object.freeze({ applied: [], skipped: [] }),
          reason: 'ALREADY_FINALIZED',
        });
      }

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
      const evidenceState = evidenceEngine.evaluate(evidence);
      const next = scheduler.chooseNext({
        evidence,
        questions,
        questionsUsed,
      });
      const hardCap =
        Number(session.hard_question_cap) || config.planner.hardQuestionCap;

      const finalizable =
        session.engine_phase === SESSION_PHASES.FINALIZING ||
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
        stateMachine.transition(
          SESSION_PHASES.ACTIVE,
          SESSION_PHASES.FINALIZING
        );
      }

      const effects = await learningEffects.applyOnce({
        reckoningId: session.id,
        userId,
        evidence,
        store: txStore,
      });

      const answeredQuestions = questions.filter(
        (question) => question.selected_option != null
      );
      const correctCount = answeredQuestions.filter(
        (question) => question.is_correct === true
      ).length;

      const completedExam = await txStore.completeExecutionExam(
        userId,
        examSessionId,
        {
          rawAccuracy: recovery.rawAccuracy,
          answeredCount: answeredQuestions.length,
          correctCount,
        }
      );
      if (!completedExam) {
        throw new ReckoningContractError(
          'Adaptive Reckoning exam could not be closed during finalization.'
        );
      }

      const finalReport = {
        survived: recovery.survived,
        rawAccuracy: recovery.rawAccuracy,
        recoveryScore: recovery.recoveryScore,
        recovered: evidenceState.recovered,
        unresolved: evidenceState.unresolved,
        criticalUnresolved: evidenceState.criticalUnresolved,
        discoveredWeaknesses: evidence
          .filter((row) => row.discovered_by_control === true)
          .map((row) => ({
            sourceCardId: row.source_card_id,
            conceptKey: row.concept_key,
            status: row.evidence_status,
          })),
        concepts: evidence.map((row) => ({
          sourceCardId: row.source_card_id,
          conceptKey: row.concept_key,
          riskLevel: row.risk_level,
          status: row.evidence_status,
          diagnosticOutcome: row.diagnostic_outcome,
          challengeOutcome: row.challenge_outcome,
          confirmationOutcome: row.confirmation_outcome,
          learningEffectApplied: Boolean(row.learning_effect_applied_at),
        })),
      };
      const persistedSession = await txStore.saveSession(session.id, {
        enginePhase: SESSION_PHASES.FINALIZING,
        currentQuestionId: null,
        checkpointPending: false,
        checkpointNextQuestionId: null,
        rawAccuracy: recovery.rawAccuracy,
        recoveryScore: recovery.recoveryScore,
        unresolvedCriticalCount: recovery.unresolvedCriticalCount,
        finalReport,
        stateVersion: (Number(session.state_version) || 0) + 1,
      });

      return Object.freeze({
        ready: true,
        alreadyFinalized: false,
        session: persistedSession || session,
        evidence,
        questions,
        recovery,
        evidenceState,
        learningEffects: effects,
        reason: recovery.survived
          ? 'RECOVERY_SUFFICIENT'
          : questionsUsed >= hardCap
            ? 'HARD_CAP_REACHED'
            : 'NO_PENDING_QUESTIONS',
      });
    });

    if (!prepared.ready || prepared.alreadyFinalized) {
      return prepared;
    }

    if (typeof outcomeHandler !== 'function') {
      const error = new ReckoningContractError(
        'Adaptive Reckoning finalization requires an outcome handler.'
      );
      error.code = 'ERR_RECKONING_OUTCOME_HANDLER_REQUIRED';
      error.status = 503;
      throw error;
    }

    const completeOutcome = async () => {
      // A concurrent request may have completed after this request prepared its
      // evidence transaction. Re-check only after obtaining the shared outcome
      // mutex so external effects can execute at most once.
      const beforeOutcome = requireAdaptiveSession(
        await store.getSession(prepared.session.id, userId)
      );
      if (beforeOutcome.engine_phase === SESSION_PHASES.COMPLETE) {
        return Object.freeze({
          ready: true,
          final: true,
          alreadyFinalized: true,
          reason: 'ALREADY_FINALIZED',
          recovery: prepared.recovery,
          evidenceState: prepared.evidenceState,
          learningEffects: prepared.learningEffects,
          outcome: null,
        });
      }

      // Card consequences and exam closure are already durable. Keep the mutex
      // through the idempotent Reckoning/Pressure/KS outcome and the final
      // COMPLETE transition so two requests cannot both cross that boundary.
      const outcome = await outcomeHandler({
        session: prepared.session,
        examSessionId,
        userId,
        recovery: prepared.recovery,
        evidenceState: prepared.evidenceState,
        learningEffects: prepared.learningEffects,
        reason: prepared.reason,
      });

      await store.withTransaction(async (txStore) => {
        const current = requireAdaptiveSession(
          await txStore.getSession(prepared.session.id, userId, { forUpdate: true })
        );
        if (current.engine_phase !== SESSION_PHASES.COMPLETE) {
          stateMachine.transition(
            SESSION_PHASES.FINALIZING,
            SESSION_PHASES.COMPLETE
          );
          await txStore.saveSession(current.id, {
            enginePhase: SESSION_PHASES.COMPLETE,
            currentQuestionId: null,
            rawAccuracy: prepared.recovery.rawAccuracy,
            recoveryScore: prepared.recovery.recoveryScore,
            unresolvedCriticalCount:
              prepared.recovery.unresolvedCriticalCount,
            stateVersion: (Number(current.state_version) || 0) + 1,
          });
        }
      });

      return Object.freeze({
        ready: true,
        final: true,
        reason: prepared.reason,
        recovery: prepared.recovery,
        evidenceState: prepared.evidenceState,
        learningEffects: prepared.learningEffects,
        outcome,
      });
    };

    if (typeof store.withOutcomeLock === 'function') {
      return store.withOutcomeLock(prepared.session.id, completeOutcome);
    }
    return completeOutcome();
  }