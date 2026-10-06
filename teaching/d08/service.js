'use strict';

const { buildSourceInventory } = require('../d07/contracts');
const {
  assessRequiredDiagnostic,
  validateCoursePlanProposal,
  reconcileCoverage,
  auditEndOfCourseCoverage,
  activationCoverageDecision,
  classifyScopeChange,
  buildStudentCoverageReport,
} = require('./contracts');
const {
  materializeCoursePlanFromTpf03,
  validateTpf03ScopeImpactOutput,
} = require('./canonical-plan');

function createD08Service({
  subjects,
  repository,
  intelligence = null,
  outboxStore = null,
  randomUUID = null,
  clock = () => new Date(),
} = {}) {
  if (!subjects || typeof subjects.getCorpusForUser !== 'function') throw new TypeError('D08 service requires the authenticated KIWI Subject corpus interface.');
  if (!repository) throw new TypeError('D08 service requires its D04/D05/D08-backed repository.');

  function held() {
    const error = new Error('Course Plan generation is temporarily unavailable.');
    error.status = 503;
    error.code = 'TEACHING_ROUTE_UNQUALIFIED';
    throw error;
  }

  function requirePlan(setup) {
    if (setup.plan) return setup.plan;
    const error = new Error('A Course Plan has not been created for this Course.');
    error.status = 409;
    error.code = 'TEACHING_D08_COURSE_PLAN_REQUIRED';
    throw error;
  }

  function latestCoverageAudit(setup, kind = null) {
    return (setup.coverageAudits || []).find((audit) => !kind || audit.audit_kind === kind) || null;
  }

  function currentPlanScopeState(setup) {
    const plan = setup.plan || null;
    if (!plan) return Object.freeze({ current: false, reason: 'COURSE_PLAN_REQUIRED' });
    if (plan.plan_state === 'REVIEW_REQUIRED') return Object.freeze({ current: false, reason: 'COURSE_PLAN_REVIEW_REQUIRED' });
    if (String(plan.source_snapshot_ref || '') !== String(setup.course.subject_snapshot_ref || '')) return Object.freeze({ current: false, reason: 'COURSE_PLAN_SOURCE_SNAPSHOT_STALE' });
    const pending = (setup.scopeChanges || []).find((row) => ['PENDING_PLAN_UPDATE','ADOPTED_PENDING_AUDIT'].includes(row.status));
    if (pending) return Object.freeze({ current: false, reason: 'COURSE_SCOPE_CHANGE_PENDING_REPLAN' });
    return Object.freeze({ current: true, reason: null });
  }

  function generationReadiness(setup) {
    const blockers = [];
    if (!setup.curriculumAudit || setup.curriculumAudit.status !== 'VALIDATED_CANDIDATE') blockers.push('CURRICULUM_AUDIT_REQUIRED');
    else if (String(setup.curriculumAudit.subject_snapshot_ref || '') !== String(setup.course.subject_snapshot_ref || '')) blockers.push('CURRICULUM_AUDIT_STALE_FOR_SCOPE');
    if ((setup.sources || []).some((source) => !source.classification)) blockers.push('SOURCE_CLASSIFICATION_INCOMPLETE');
    const diagnostic = assessRequiredDiagnostic({ diagnosticPlan: setup.diagnosticPlan, vpkDecisions: setup.vpkDecisions });
    if (!diagnostic.resolved) blockers.push('REQUIRED_DIAGNOSTIC_UNRESOLVED');
    return Object.freeze({ blockers: Object.freeze(blockers), diagnostic });
  }

  function backgroundGenerationProjection(job) {
    if (!job) return null;
    return Object.freeze({
      eventId: job.event_id,
      status: String(job.status || '').toUpperCase(),
      attemptCount: Number(job.attempt_count || 0),
      lastErrorCode: job.last_error_code || null,
      nextAttemptAt: job.next_attempt_at || null,
      createdAt: job.created_at || null,
      updatedAt: job.updated_at || null,
      publishedAt: job.published_at || null,
      aggregateVersion: job.aggregate_version == null ? null : Number(job.aggregate_version),
      causationId: job.causation_id || null,
    });
  }

  function buildPreviousPlanContext(setup) {
    if (!setup.plan) return null;
    const coverageById = new Map((setup.coverage || []).map((row) => [String(row.coverage_entry_id), row]));
    const unitById = new Map((setup.learningUnits || []).map((unit) => [String(unit.learning_unit_id), unit]));
    return Object.freeze({
      version: Number(setup.plan.version_no),
      units: Object.freeze((setup.learningUnits || []).map((unit) => Object.freeze({
        key: String(unit.metadata?.canonical_key || unit.metadata?.plan_node_ref || unit.learning_unit_id),
        title: unit.title,
      }))),
      sourceMappings: Object.freeze((setup.coverageMappings || []).map((mapping) => {
        const coverage = coverageById.get(String(mapping.coverage_entry_id));
        const unit = unitById.get(String(mapping.learning_unit_id));
        return Object.freeze({
          learning_unit_key: String(unit?.metadata?.canonical_key || unit?.metadata?.plan_node_ref || mapping.learning_unit_id),
          source_ref: String(coverage?.source_ref || ''),
        });
      }).filter((item) => item.source_ref)),
    });
  }

  function sanitizePlanReview(setup) {
    const coverageReport = setup.plan
      ? buildStudentCoverageReport({
          course: setup.course,
          plan: setup.plan,
          sources: setup.sources,
          coverageRows: setup.coverage,
          mappings: setup.coverageMappings,
          assumedPrerequisites: setup.assumedPrerequisites,
          latestCoverageAudit: latestCoverageAudit(setup, 'PRE_ACTIVATION'),
        })
      : null;
    const subtopicsByTopic = new Map();
    for (const subtopic of setup.subtopics || []) {
      if (!subtopicsByTopic.has(subtopic.topic_id)) subtopicsByTopic.set(subtopic.topic_id, []);
      subtopicsByTopic.get(subtopic.topic_id).push(subtopic);
    }
    const unitsByTopic = new Map();
    for (const unit of setup.learningUnits || []) {
      if (!unitsByTopic.has(unit.topic_id)) unitsByTopic.set(unit.topic_id, []);
      unitsByTopic.get(unit.topic_id).push(unit);
    }
    const scopeState = currentPlanScopeState(setup);
    const readiness = generationReadiness(setup);
    const diagnostic = readiness.diagnostic;
    const generationBlockers = readiness.blockers;
    const auditOutput = setup.curriculumAudit?.audit_output || {};
    const meaningfulSources = (setup.sources || []).filter((source) => source.classification === 'ACADEMICALLY_MEANINGFUL' && source.academically_meaningful !== false);
    const excludedSources = (setup.sources || []).filter((source) => source.classification && source.classification !== 'ACADEMICALLY_MEANINGFUL');
    const sourceAnalysis = Object.freeze({
      auditStatus: setup.curriculumAudit?.status || null,
      sourceCount: (setup.sources || []).length,
      meaningfulCount: meaningfulSources.length,
      excludedCount: excludedSources.length,
      topics: Object.freeze((auditOutput.topics || []).map((topic) => Object.freeze({
        title: topic.title,
        subtopics: Object.freeze((topic.subtopics || []).map((subtopic) => Object.freeze({ title: subtopic.title }))),
      }))),
      learningUnitCount: Array.isArray(auditOutput.learning_units) ? auditOutput.learning_units.length : 0,
      assumptions: Object.freeze((auditOutput.assumed_prerequisites || []).map((item) => Object.freeze({
        label: item.label || item.title || item.prerequisite_ref || 'Assumed prerequisite',
        description: item.description || item.reason || item.rationale || null,
      }))),
      exclusions: Object.freeze(excludedSources.map((source) => Object.freeze({
        classification: source.classification,
        reason: source.classification_reason || 'Explicitly excluded by validated source classification.',
        summary: source.content_summary || null,
      }))),
    });
    return Object.freeze({
      course: Object.freeze({
        courseId: setup.course.course_id,
        title: setup.course.title,
        lifecycleState: setup.course.lifecycle_state,
        stateVersion: Number(setup.course.state_version),
      }),
      stage: 'COURSE_PLAN_AND_COVERAGE_REVIEW',
      routeQualification: intelligence ? 'QUALIFIED_BY_RUNTIME_INJECTION' : 'ROUTE_UNAVAILABLE',
      generation: Object.freeze({
        available: Boolean(intelligence),
        ready: Boolean(intelligence) && generationBlockers.length === 0,
        blockers: Object.freeze([...generationBlockers]),
        background: backgroundGenerationProjection(setup.backgroundPlanGeneration),
      }),
      sourceAnalysis,
      plan: setup.plan ? Object.freeze({
        version: Number(setup.plan.version_no),
        state: setup.plan.plan_state,
        createdAt: setup.plan.created_at,
        currentForCourseScope: scopeState.current,
        scopeHoldReason: scopeState.reason,
        topics: Object.freeze((setup.topics || []).map((topic) => Object.freeze({
          title: topic.title,
          subtopics: Object.freeze((subtopicsByTopic.get(topic.topic_id) || []).map((subtopic) => Object.freeze({ title: subtopic.title }))),
          learningUnits: Object.freeze((unitsByTopic.get(topic.topic_id) || []).map((unit) => Object.freeze({
            title: unit.title,
            intendedCompetence: unit.intended_competence,
            exitConditions: unit.exit_conditions,
            criticality: unit.criticality,
            foundational: unit.foundational,
            instructionalTreatment: unit.metadata?.instructional_treatment || 'FULL_INSTRUCTION',
          }))),
        }))),
      }) : null,
      assumptions: Object.freeze((setup.assumedPrerequisites || []).map((item) => Object.freeze({
        label: item.label,
        description: item.description,
        state: item.resolution_state,
        disclosure: item.disclosure_text,
      }))),
      coverageReport,
      scopeChange: setup.scopeChanges?.[0] ? Object.freeze({
        kind: setup.scopeChanges[0].change_kind,
        status: setup.scopeChanges[0].status,
        detectedAt: setup.scopeChanges[0].detected_at,
      }) : null,
      invariants: Object.freeze({
        coverageIsNotMastery: true,
        rawSubjectScopeIsNotAssessmentEligibility: true,
        studentIntakeIsNotEvidence: true,
      }),
    });
  }

  async function getPlanReview(user, courseId) {
    return sanitizePlanReview(await repository.getPlanReview(user.id, courseId));
  }

  function assertGenerationReady(setup) {
    const readiness = generationReadiness(setup);
    const blocker = readiness.blockers[0] || null;
    if (!blocker) return readiness;
    const messages = {
      CURRICULUM_AUDIT_REQUIRED: 'A validated Curriculum Audit is required before Course Plan generation.',
      CURRICULUM_AUDIT_STALE_FOR_SCOPE: 'The current Course source snapshot requires a new validated Curriculum Audit before Course Plan generation.',
      SOURCE_CLASSIFICATION_INCOMPLETE: 'Every current source item must be classified by the validated Curriculum Audit before Course Plan generation.',
      REQUIRED_DIAGNOSTIC_UNRESOLVED: 'Required targeted Diagnostic evidence must be resolved before Course Plan generation.',
    };
    const codes = {
      CURRICULUM_AUDIT_REQUIRED: 'TEACHING_D08_CURRICULUM_AUDIT_REQUIRED',
      CURRICULUM_AUDIT_STALE_FOR_SCOPE: 'TEACHING_D08_CURRICULUM_AUDIT_STALE_FOR_SCOPE',
      SOURCE_CLASSIFICATION_INCOMPLETE: 'TEACHING_D08_SOURCE_CLASSIFICATION_INCOMPLETE',
      REQUIRED_DIAGNOSTIC_UNRESOLVED: 'TEACHING_D08_REQUIRED_DIAGNOSTIC_UNRESOLVED',
    };
    const error = new Error(messages[blocker] || 'Course Plan generation is not ready.');
    error.status = 409;
    error.code = codes[blocker] || 'TEACHING_D08_COURSE_PLAN_NOT_READY';
    if (blocker === 'REQUIRED_DIAGNOSTIC_UNRESOLVED') error.unresolvedTargets = readiness.diagnostic.unresolvedTargets;
    throw error;
  }

  async function generateCoursePlan(user, courseId) {
    const setup = await repository.getBaseSetup(user.id, courseId);
    assertGenerationReady(setup);
    if (!intelligence) held();
    const existing = await repository.getPlanReview(user.id, courseId);
    const previousPlanContext = buildPreviousPlanContext(existing);
    const result = await intelligence.generateCoursePlan({
      course: setup.course,
      audit: setup.curriculumAudit,
      diagnosticPlan: setup.diagnosticPlan,
      vpkDecisions: setup.vpkDecisions,
      sources: setup.sources,
      previousPlanContext,
    });
    if (!result?.accepted) {
      const error = new Error('Course Plan proposal was rejected by Teaching validation.');
      error.status = 422; error.code = 'TEACHING_D08_COURSE_PLAN_REJECTED'; throw error;
    }
    const materialized = materializeCoursePlanFromTpf03(result.validatedResult?.output, {
      audit: setup.curriculumAudit,
      sources: setup.sources,
      vpkDecisions: setup.vpkDecisions,
      previousPlanContext,
    });
    if (!materialized.ok) {
      const error = new Error(materialized.message || 'Course Plan proposal failed canonical TPF-03 materialization.');
      error.status = 422; error.code = materialized.reason; throw error;
    }
    const validated = validateCoursePlanProposal(materialized.value, {
      sources: setup.sources,
      vpkDecisions: setup.vpkDecisions,
      diagnosticPlan: setup.diagnosticPlan,
    });
    if (!validated.ok) {
      const error = new Error(validated.message || 'Course Plan proposal failed deterministic domain validation.');
      error.status = 422; error.code = validated.reason; throw error;
    }
    const coverage = reconcileCoverage({
      sources: setup.sources,
      mappings: validated.value.source_mappings,
      vpkDecisions: setup.vpkDecisions,
      learningUnits: validated.value.learning_units,
    });
    if (coverage.outcome !== 'PASS') {
      const error = new Error('Required Course content remains unmapped.');
      error.status = 422; error.code = 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED'; throw error;
    }
    const pendingScopeChange = (existing.scopeChanges || []).find((item) => item.status === 'ADOPTED_PENDING_AUDIT' || item.status === 'PENDING_PLAN_UPDATE') || null;
    await repository.saveCoursePlan({
      studentId: user.id,
      courseId,
      expectedCourseStateVersion: setup.course.state_version,
      audit: setup.curriculumAudit,
      diagnosticPlan: setup.diagnosticPlan,
      sourceInventoryDigest: setup.curriculumAudit.source_inventory_digest,
      proposal: validated.value,
      coverage,
      generationProvenance: {
        capability_id: 'teaching.curriculum.course_plan_generation',
        prompt_family_id: 'TPF-03',
        prompt_family_version: '1.0',
        task_mode: 'course_plan_generation',
        output_schema_version: 'tpf03.course-plan-scope-planning/1',
        execution_id: result.executionId || result.execution_id || null,
        validation: 'frozen-schema+domain+authority+provenance+state-version+deterministic-coverage',
      },
      scopeDiff: pendingScopeChange ? { scope_change_id: pendingScopeChange.scope_change_id, impact: pendingScopeChange.impact_summary } : {},
    });
    return sanitizePlanReview(await repository.getPlanReview(user.id, courseId));
  }

  async function queueCoursePlan(user, courseId) {
    if (!intelligence) held();
    if (!outboxStore || typeof outboxStore.append !== 'function' || typeof randomUUID !== 'function') {
      const error = new Error('Background Course Plan generation is temporarily unavailable.');
      error.status = 503;
      error.code = 'TEACHING_D08_BACKGROUND_GENERATION_UNAVAILABLE';
      throw error;
    }

    const setup = await repository.getPlanReview(user.id, courseId);
    assertGenerationReady(setup);

    const scope = currentPlanScopeState(setup);
    if (setup.plan && scope.current) {
      return Object.freeze({
        accepted: true,
        background: false,
        status: 'COMPLETED',
        planReady: true,
        planVersion: Number(setup.plan.version_no),
      });
    }

    const current = setup.backgroundPlanGeneration || null;
    const currentStatus = String(current?.status || '').toUpperCase();
    if (['PENDING','CLAIMED','RETRY_WAIT'].includes(currentStatus)) {
      return Object.freeze({
        accepted: true,
        background: true,
        jobId: current.event_id,
        status: currentStatus,
        joinedExisting: true,
      });
    }
    if (currentStatus === 'PUBLISHED') {
      const refreshed = await repository.getPlanReview(user.id, courseId);
      const refreshedScope = currentPlanScopeState(refreshed);
      if (refreshed.plan && refreshedScope.current) {
        return Object.freeze({
          accepted: true,
          background: false,
          status: 'COMPLETED',
          planReady: true,
          planVersion: Number(refreshed.plan.version_no),
        });
      }
    }

    const eventId = randomUUID();
    const now = clock().toISOString();
    const baseKey = `d08:course-plan:${courseId}:${setup.course.state_version}:tpf03:1.0`;
    const idempotencyKey = currentStatus === 'CANCELLED'
      ? `${baseKey}:recovery:${current.event_id}`
      : baseKey;
    const queued = await outboxStore.append({
      eventId,
      schemaVersion: 1,
      eventType: 'teaching.course_plan.generation_requested',
      eventCategory: 'operational_recovery_event',
      triggerType: 'background_analysis',
      source: 'teaching.d08',
      origin: 'teaching.course_plan_review',
      actorId: String(user.id),
      aggregateType: 'teaching_course',
      aggregateId: String(courseId),
      aggregateVersion: Number(setup.course.state_version),
      occurredAt: now,
      correlationId: eventId,
      causationId: currentStatus === 'CANCELLED' ? String(current.event_id) : null,
      idempotencyKey,
      payload: {
        course_id: String(courseId),
        expected_state_version: String(setup.course.state_version),
      },
      auditRefs: setup.curriculumAudit?.curriculum_audit_id
        ? [`curriculum-audit:${setup.curriculumAudit.curriculum_audit_id}`]
        : [],
      provenanceRefs: (setup.sources || []).map((source) => `source:${source.source_content_item_id}`),
    });
    return Object.freeze({
      accepted: true,
      background: true,
      jobId: queued.event.event_id,
      status: queued.event.status,
      joinedExisting: queued.inserted === false,
    });
  }

  async function getCoverageReport(user, courseId) {
    const setup = await repository.getPlanReview(user.id, courseId);
    requirePlan(setup);
    return buildStudentCoverageReport({
      course: setup.course,
      plan: setup.plan,
      sources: setup.sources,
      coverageRows: setup.coverage,
      mappings: setup.coverageMappings,
      assumedPrerequisites: setup.assumedPrerequisites,
      latestCoverageAudit: latestCoverageAudit(setup),
    });
  }

  async function getActivationCoverageDecision(user, courseId) {
    const setup = await repository.getPlanReview(user.id, courseId);
    requirePlan(setup);
    const scope = currentPlanScopeState(setup);
    if (!scope.current) return Object.freeze({ allowed: false, outcome: 'FAIL', blockingReasons: [scope.reason], policyVersion: 'coverage-reconciliation.v1' });
    const diagnostic = assessRequiredDiagnostic({ diagnosticPlan: setup.diagnosticPlan, vpkDecisions: setup.vpkDecisions });
    return activationCoverageDecision({ preActivationAudit: latestCoverageAudit(setup, 'PRE_ACTIVATION'), diagnosticResolved: diagnostic.resolved });
  }

  async function auditEndOfCourse(user, courseId) {
    const setup = await repository.getPlanReview(user.id, courseId);
    const plan = requirePlan(setup);
    const scope = currentPlanScopeState(setup);
    if (!scope.current) {
      return Object.freeze({
        outcome: 'FAIL', completionAllowed: false, requiredCount: 0, instructionallyCompleteCount: 0, unresolvedCount: 1,
        nextPath: 'INCOMPLETE_REQUIRED_CONTENT_RECOVERY', policyVersion: 'incomplete-required-content.v1', blockingReasons: [scope.reason],
        note: 'The Course Plan no longer matches the authoritative Course scope; re-audit and replan before completion can be evaluated.',
      });
    }
    const requiredSources = setup.sources.filter((source) => source.classification === 'ACADEMICALLY_MEANINGFUL' && source.academically_meaningful !== false);
    const result = auditEndOfCourseCoverage({ coverageRows: setup.coverage, requiredSourceIds: requiredSources.map((source) => source.source_content_item_id) });
    const saved = await repository.saveCoverageAudit({
      studentId: user.id,
      courseId,
      planId: plan.course_plan_id,
      kind: 'END_OF_COURSE',
      result: {
        ...result,
        mappedCount: setup.coverage.filter((row) => row.mapped_at).length,
        excludedCount: setup.coverage.filter((row) => row.excluded_at).length,
        policyVersion: 'coverage-reconciliation.v1',
        blockingReasons: result.outcome === 'FAIL' ? ['INCOMPLETE_REQUIRED_CONTENT'] : [],
      },
      courseStateVersion: setup.course.state_version,
    });
    return Object.freeze({
      outcome: saved.outcome,
      completionAllowed: result.completionAllowed,
      requiredCount: result.requiredCount,
      instructionallyCompleteCount: result.instructionallyCompleteCount,
      unresolvedCount: result.unresolvedSourceRefs.length,
      nextPath: result.completionAllowed ? 'COURSE_LIFECYCLE_MAY_EVALUATE_COMPLETION' : 'INCOMPLETE_REQUIRED_CONTENT_RECOVERY',
      policyVersion: 'incomplete-required-content.v1',
      note: 'D08 records the coverage gate only; Course lifecycle/Progression owns the actual completion outcome.',
    });
  }

  async function detectScopeChange(user, courseId) {
    const setup = await repository.getBaseSetup(user.id, courseId);
    const corpus = await subjects.getCorpusForUser(user.id, setup.course.subject_id);
    const subjectMaterialRole = setup.sources.some((source) => source.source_kind === 'KIWI_SUBJECT_FLASHCARDS') ? 'SUPPLEMENTAL_FLASHCARD' : null;
    const currentInventory = buildSourceInventory({ corpus, supplementaryMaterials: [], subjectMaterialRole });
    const activePrimary = setup.sources.filter((source) => ['PRIMARY_KIWI_SUBJECT','KIWI_SUBJECT_FLASHCARDS'].includes(source.source_kind));
    const oldByRef = new Map(activePrimary.map((source) => [String(source.source_ref), source]));
    const newByRef = new Map(currentInventory.items.filter((item) => ['PRIMARY_KIWI_SUBJECT','KIWI_SUBJECT_FLASHCARDS'].includes(item.sourceKind)).map((item) => [String(item.sourceRef), item]));
    const added = [...newByRef.keys()].filter((ref) => !oldByRef.has(ref));
    const removed = [...oldByRef.keys()].filter((ref) => !newByRef.has(ref));
    const changed = [...newByRef.keys()].filter((ref) => oldByRef.has(ref) && oldByRef.get(ref).content_hash !== newByRef.get(ref).contentHash);
    const classification = classifyScopeChange({ origin: 'SUBJECT', added, removed, changed, authoritativeScope: true });
    const observedSnapshotRef = `subject:${setup.course.subject_id}:${currentInventory.snapshotDigest}`;
    const candidate = await repository.saveScopeChangeCandidate({
      studentId: user.id, courseId, expectedCourseStateVersion: setup.course.state_version,
      previousSnapshotRef: setup.course.subject_snapshot_ref, observedSnapshotRef, classification,
      addedRefs: added, removedRefs: removed, changedRefs: changed,
    });
    return Object.freeze({
      scopeChangeId: candidate.scope_change_id,
      changeKind: candidate.change_kind, status: candidate.status,
      addedCount: added.length, removedCount: removed.length, changedCount: changed.length,
      requiresReview: classification.requiresReview, currentCoursePlanUnchanged: true,
      message: classification.changeKind === 'NO_CHANGE'
        ? 'The current KIWI Subject still matches this Course source baseline.'
        : 'The KIWI Subject changed. The current Course Plan will not inherit those changes until versioned scope review and explicit adoption are completed.',
    });
  }

  async function analyzeScopeChange(user, courseId, scopeChangeId) {
    if (!intelligence) held();
    const setup = await repository.getPlanReview(user.id, courseId);
    const plan = requirePlan(setup);
    const candidate = (setup.scopeChanges || []).find((item) => item.scope_change_id === scopeChangeId);
    if (!candidate) { const error = new Error('Scope-change candidate not found.'); error.status = 404; error.code = 'TEACHING_D08_SCOPE_CHANGE_NOT_FOUND'; throw error; }
    const result = await intelligence.analyzeScopeChange({ course: setup.course, plan, candidate });
    if (!result?.accepted) { const error = new Error('Scope-change impact proposal failed validation.'); error.status = 422; error.code = 'TEACHING_D08_SCOPE_CHANGE_IMPACT_REJECTED'; throw error; }
    const validated = validateTpf03ScopeImpactOutput(result.validatedResult?.output, { course: setup.course, plan, scopeChangeId });
    if (!validated.ok) { const error = new Error(validated.message); error.status = 422; error.code = validated.reason; throw error; }
    // Authoritative Subject change is material by source authority even if the model recommends no version.
    const safeImpact = candidate.change_kind === 'REVIEW_REQUIRED'
      ? { ...validated.value, change_kind: 'MATERIAL_SCOPE_CHANGE', plan_version_recommended: true, review_needed: true }
      : validated.value;
    return repository.saveScopeChangeImpact({ studentId: user.id, courseId, scopeChangeId, impact: safeImpact });
  }

  async function adoptAuthoritativeScopeChange(user, courseId, scopeChangeId) {
    const setup = await repository.getPlanReview(user.id, courseId);
    const candidate = (setup.scopeChanges || []).find((item) => item.scope_change_id === scopeChangeId);
    if (!candidate || candidate.change_kind !== 'MATERIAL_SCOPE_CHANGE' || candidate.status !== 'PENDING_PLAN_UPDATE') {
      const error = new Error('The scope change is not a validated material update ready for domain adoption.'); error.status = 409; error.code = 'TEACHING_D08_SCOPE_CHANGE_NOT_ADOPTABLE'; throw error;
    }
    const corpus = await subjects.getCorpusForUser(user.id, setup.course.subject_id);
    const subjectMaterialRole = setup.sources.some((source) => source.source_kind === 'KIWI_SUBJECT_FLASHCARDS') ? 'SUPPLEMENTAL_FLASHCARD' : null;
    const inventory = buildSourceInventory({ corpus, supplementaryMaterials: [], subjectMaterialRole });
    if (`subject:${setup.course.subject_id}:${inventory.snapshotDigest}` !== candidate.observed_snapshot_ref) {
      const error = new Error('Subject content changed again after scope impact review; review must be repeated.'); error.status = 409; error.code = 'TEACHING_D08_SCOPE_CHANGE_STALE'; throw error;
    }
    return repository.adoptAuthoritativeScopeChange({ studentId: user.id, courseId, scopeChangeId, expectedCourseStateVersion: setup.course.state_version, inventory });
  }

  async function reconcileVpkContradiction(user, courseId, decisionId, input = {}) {
    const decision = await repository.getVpkDecision(user.id, courseId, decisionId);
    if (!decision) { const error = new Error('Validated-prior-knowledge decision not found.'); error.status = 404; error.code = 'TEACHING_D08_VPK_DECISION_NOT_FOUND'; throw error; }
    if (decision.decision_status !== 'VALIDATED_PRIOR_KNOWLEDGE') { const error = new Error('Only a current validated-prior-knowledge decision can be downgraded by later contradiction.'); error.status = 409; error.code = 'TEACHING_D08_VPK_ALREADY_NOT_VALIDATED'; throw error; }
    const evidenceRefs = Array.isArray(input.evidenceRefs) ? [...new Set(input.evidenceRefs.map(String))] : [];
    if (!evidenceRefs.length) { const error = new Error('Server-held controlled evidence references are required.'); error.status = 400; error.code = 'TEACHING_D08_VPK_CONTRADICTION_EVIDENCE_REQUIRED'; throw error; }
    const rows = await repository.loadControlledContradictionEvidence({ studentId: user.id, courseId, decision, evidenceRefs });
    if (rows.length !== evidenceRefs.length) { const error = new Error('Every contradiction reference must resolve to target-linked controlled evidence.'); error.status = 422; error.code = 'TEACHING_D08_VPK_CONTRADICTION_EVIDENCE_UNRESOLVED'; throw error; }
    const contradictory = rows.some((row) => row.response_quality?.passed === false || row.response_quality?.contradicts_prior_knowledge === true || row.response_quality?.unresolved_material_contradiction === true);
    if (!contradictory) { const error = new Error('Controlled evidence does not establish a material contradiction.'); error.status = 422; error.code = 'TEACHING_D08_VPK_NO_MATERIAL_CONTRADICTION'; throw error; }
    return repository.supersedeVpkDecisionWithContradiction({ studentId: user.id, courseId, decision, evidenceRows: rows });
  }

  return Object.freeze({
    getPlanReview,
    queueCoursePlan,
    generateCoursePlan,
    getCoverageReport,
    getActivationCoverageDecision,
    auditEndOfCourse,
    detectScopeChange,
    analyzeScopeChange,
    adoptAuthoritativeScopeChange,
    reconcileVpkContradiction,
  });
}

module.exports = { createD08Service };
