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
  const learningEffects =
    options.learningEffectsEngine || createLearningEffectsEngine({ config });
  const stateMachine = options.stateMachine || createStateMachine();
  const outcomeHandler = options.outcomeHandler || null;
  const preparation = options.preparation || null;

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
    const checkpoint = checkpointDue
      ? Object.freeze({
          recovered: evidenceState.recovered,
          unresolved: evidenceState.unresolved,
          provisional:
            evidenceState.provisional +
            evidenceState.challengeRequired +
            evidenceState.confirmationRequired,
          criticalRemaining: evidenceState.criticalUnresolved,
          recentMisses: Object.freeze(
            history
              .filter((item) => item.isCorrect === false)
              .slice(-3)
              .map((item) => Object.freeze({
                role: item.role,
                stem: item.stem,
                explanation: item.explanation,
              }))
          ),
        })
      : null;
    const report = phase === SESSION_PHASES.COMPLETE || phase === SESSION_PHASES.FINALIZING
      ? buildDiagnosticReport({
          evidence,
          recovery: score,
          subjectName: session.subject_name || 'Subject',
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
      subjectName: session.subject_name || 'Subject',
      reviewStartedAt: session.review_started_at || null,
      safetyExpiresAt: session.safety_expires_at || null,
      checkpointDue,
      checkpoint,
      currentQuestion: sanitizeCurrentQuestion(currentQuestion),
      history: Object.freeze(history),
      evidence: Object.freeze(evidence.map(evidenceSummary)),
      evidenceState,
      recovery: score,
      report,
      final:
        phase === SESSION_PHASES.FINALIZING ||
        phase === SESSION_PHASES.COMPLETE,
    });
  }

  function isSafetyExpired(session, now = Date.now()) {
    if (!session?.safety_expires_at) return false;
    const expiresAt = new Date(session.safety_expires_at).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= Number(now);