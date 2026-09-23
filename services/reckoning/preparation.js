            lastError = error;
          }
        }
        if (!generated) {
          throw new ReckoningContractError(
            `Unable to generate a valid ${blueprint.role} after ${generationAttempts} attempts: ${lastError?.message || 'unknown error'}`
          );
        }
        output.push(generated);
        previousQuestion = generated.question;
      }
      return output;
    });

    const generated = nested.flat();
    validateGeneratedFamily(generated, plan);
    return Object.freeze(generated);
  }

  async function prepareAndStart({
    reckoning,
    userId,
    subjectId,
    plan,
    deckIds = [],
    ksBefore = null,
  } = {}) {
    if (!reckoning?.id || !userId || !subjectId || !plan) {
      throw new ReckoningContractError(
        'prepareAndStart requires reckoning, userId, subjectId and plan.'
      );
    }

    const existing = await store.getSession(reckoning.id, userId);
    const existingDeferredUntil = existing?.deferred_until
      ? new Date(existing.deferred_until).getTime()
      : 0;
    if (existingDeferredUntil > clock().getTime()) {
      const error = new ReckoningContractError('This Reckoning is still deferred.');
      error.code = 'RECKONING_DEFERRED';
      error.status = 409;
      error.deferredUntil = existing.deferred_until;
      throw error;
    }
    if (
      existing?.engine_version === 2 &&
      ['PILOT', 'LIVE'].includes(String(existing.engine_mode || '')) &&
      existing.status === 'in_progress' &&
      existing.exam_session_id
    ) {
      return Object.freeze({
        alreadyStarted: true,
        examSessionId: existing.exam_session_id,
        reckoningId: existing.id,
      });
    }

    const claimed = await store.claimGeneration(reckoning.id, userId);
    if (!claimed) {
      const current = await store.getSession(reckoning.id, userId);
      if (current?.status === 'in_progress' && current?.exam_session_id) {
        return Object.freeze({
          alreadyStarted: true,
          examSessionId: current.exam_session_id,
          reckoningId: current.id,
        });
      }
      const error = new ReckoningContractError('Reckoning preparation is already in progress.');
      error.code = 'ERR_RECKONING_PREPARING';
      error.status = 409;
      throw error;
    }

    const existingEvidence = await store.getEvidence(reckoning.id);
    const existingByCardId = new Map(
      existingEvidence
        .filter((row) => row.source_card_id)
        .map((row) => [String(row.source_card_id), row])
    );
    const livePlan = attachEvidenceIds(plan, randomUUID, existingByCardId);
    let generated;
    try {
      generated = await generateQuestionFamily(livePlan, reckoning.id);
    } catch (error) {
      await store.markGenerationFailure(reckoning.id, error.message).catch(() => null);
      throw error;
    }

    const examSessionId = randomUUID();
    const questionRows = generated.map((item, index) =>
      generatedToQuestionRow({
        generated: item,
        userId,
        examSessionId,
        questionNumber: index + 1,
        randomUUID,
      })
    );

    const syntheticEvidence = [...livePlan.evidence, ...livePlan.controls].map((item) => ({
      id: item.id,
      risk_score: item.riskScore,
      risk_level: item.riskLevel,
      evidence_status: 'UNTESTED',
      next_eligible_question: null,
    }));
    const syntheticQuestions = questionRows.map((row) => ({ ...row }));
    const first = scheduler.chooseNext({
      evidence: syntheticEvidence,
      questions: syntheticQuestions,
      questionsUsed: 0,
      lastEvidenceId: null,
    });
    if (first.type !== 'QUESTION' || !first.questionId) {
      await store.markGenerationFailure(reckoning.id, 'No valid first question could be scheduled.')
        .catch(() => null);
      throw new ReckoningContractError('Prepared Reckoning has no schedulable first question.');
    }

    const now = clock();
    const safetyExpiresAt = new Date(
      now.getTime() + config.execution.safetyWindowMinutes * 60000
    );

    try {
      return await store.withTransaction(async (txStore) => {
        const locked = await txStore.getSession(reckoning.id, userId, { forUpdate: true });
        if (!locked) throw new ReckoningContractError('Reckoning session disappeared during preparation.');
        if (locked.status === 'in_progress' && locked.exam_session_id) {
          return Object.freeze({
            alreadyStarted: true,
            examSessionId: locked.exam_session_id,
            reckoningId: locked.id,
          });
        }
        if (!['triggered', 'deferred'].includes(String(locked.status))) {
          throw new ReckoningContractError(
            `Reckoning cannot start from status ${locked.status}.`
          );
        }
        const deferredUntil = locked.deferred_until
          ? new Date(locked.deferred_until).getTime()
          : 0;
        if (deferredUntil > now.getTime()) {
          const error = new ReckoningContractError('This Reckoning is still deferred.');
          error.code = 'RECKONING_DEFERRED';
          error.status = 409;
          throw error;
        }

        for (const evidence of [...livePlan.evidence, ...livePlan.controls]) {
          const existing = existingByCardId.get(String(evidence.sourceCardId));
          if (existing) {
            // Reuse the same evidence identity across failed attempts. Terminal
            // Recovered evidence is normally excluded by the planner caller; an
            // explicitly selected prior row is reset for a new independent attempt.
            // learning_effect_applied_at is deliberately NOT cleared, preventing
            // repeated SRS punishment for the same Reckoning across retries.
            await txStore.saveEvidence(existing.id, {
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
              diagnosticOutcome: null,
              challengeOutcome: null,
              confirmationOutcome: null,
              attemptCount: 0,
              successfulDemonstrations: 0,
              requiredConfirmations: evidence.requiredConfirmations,
              questionsSeen: 0,
              lastQuestionRole: null,
              nextEligibleQuestion: null,
              resolvedAt: null,
            });
          } else {
            await txStore.createEvidence({
              id: evidence.id,
              reckoningId: locked.id,
              userId,
              subjectId,
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
        }

        await txStore.createExecutionExam({
          id: examSessionId,
          userId,
          subjectId,
          deckIds,
          questionCount: questionRows.length,
          safetyWindowSeconds: config.execution.safetyWindowMinutes * 60,
          startedAt: now,
          ksBefore,
        });

        for (const question of questionRows) {
          await txStore.createExecutionQuestion({
            ...question,
            is_unlocked: question.id === first.questionId,
            unlocked_at: question.id === first.questionId ? now : null,
          });
        }

        await txStore.saveSession(locked.id, {
          engineVersion: config.engineVersion,
          engineMode: 'LIVE',
          enginePhase: SESSION_PHASES.ACTIVE,
          questionsUsed: 0,
          softQuestionBudget: livePlan.softQuestionBudget,
          hardQuestionCap: livePlan.hardQuestionCap,
          recoveryScore: 0,
          rawAccuracy: 0,
          unresolvedCriticalCount: livePlan.critical.length,
          currentBlock: 1,
          currentQuestionId: first.questionId,
          stateVersion: (Number(locked.state_version) || 0) + 1,
          preparedAt: now,
          reviewStartedAt: now,
          safetyExpiresAt,
          generationStatus: 'ready',
          generationError: null,
          plannerVersion: config.plannerVersion,
          configVersion: config.configVersion,
        });

        await txStore.activateReckoningRow(locked.id, examSessionId);

        return Object.freeze({
          alreadyStarted: false,
          examSessionId,
          reckoningId: locked.id,