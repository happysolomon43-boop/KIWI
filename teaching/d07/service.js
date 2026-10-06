'use strict';

const {
  normalizeIntake,
  buildSourceInventory,
  selectDiagnosticRequirement,
  evaluateValidatedPriorKnowledge,
  digest,
} = require('./contracts');
const { validateSupplementaryMaterialInput } = require('../d28/security');

function createD07Service({
  subjects,
  repository,
  intelligence = null,
  outboxStore = null,
  randomUUID = null,
  clock = () => new Date(),
  logger = console,
} = {}) {
  if (!subjects || typeof subjects.getForUser !== 'function' || typeof subjects.getCorpusForUser !== 'function') {
    throw new TypeError('D07 service requires the authenticated KIWI Subject corpus interface.');
  }
  if (!repository) throw new TypeError('D07 service requires its D04-backed repository.');

  const held = () => {
    const error = new Error('Course preparation is temporarily unavailable.');
    error.status = 503;
    error.code = 'TEACHING_ROUTE_UNQUALIFIED';
    throw error;
  };
  const queueUnavailable = () => {
    const error = new Error('Background analysis is temporarily unavailable.');
    error.status = 503;
    error.code = 'TEACHING_BACKGROUND_ANALYSIS_UNAVAILABLE';
    throw error;
  };
  const sourceInventoryDigest = (sources = []) => digest(
    sources.map((source) => [source.source_ref, source.content_hash])
  );

  async function autoQueueAuditAfterDraft(user, courseId) {
    if (!intelligence || !outboxStore || typeof outboxStore.append !== 'function' || typeof randomUUID !== 'function') {
      return null;
    }
    try {
      return await queueAudit(user, courseId);
    } catch (error) {
      logger?.warn?.('[KIWI Teaching D07] Course draft saved but automatic curriculum analysis could not be queued.', {
        courseId: String(courseId),
        userId: String(user?.id || ''),
        code: error?.code || 'TEACHING_BACKGROUND_ANALYSIS_QUEUE_FAILED',
        message: String(error?.message || error).slice(0, 300),
      });
      return {
        accepted: false,
        background: true,
        status: 'QUEUE_FAILED',
        code: error?.code || 'TEACHING_BACKGROUND_ANALYSIS_QUEUE_FAILED',
      };
    }
  }

  async function createCourse(user, input = {}) {
    const subjectId = String(input.subjectId || '').trim();
    if (!subjectId) {
      const error = new Error('subjectId is required.');
      error.status = 400;
      throw error;
    }
    const subject = await subjects.getForUser(user.id, subjectId);
    if (!subject) {
      const error = new Error('Subject not found.');
      error.status = 404;
      error.code = 'TEACHING_SUBJECT_NOT_FOUND';
      throw error;
    }
    const corpus = await subjects.getCorpusForUser(user.id, subjectId);
    const originalMaterials = (input.originalMaterials || []).map((material) =>
      validateSupplementaryMaterialInput({ ...material, sourceKind: 'PRIMARY_STUDY_NOTE' })
    );
    const supplementaryMaterials = (input.supplementaryMaterials || []).map((material) =>
      validateSupplementaryMaterialInput(material)
    );
    const inventory = buildSourceInventory({ corpus, originalMaterials, supplementaryMaterials });
    const title = String(input.title || subject.name || 'Untitled Course').trim();
    const existing = typeof repository.findMatchingDraft === 'function'
      ? await repository.findMatchingDraft({ studentId: user.id, subjectId, title })
      : null;
    if (existing) {
      const error = new Error('A Draft Course already exists for this KIWI Subject. Open the existing Course instead of creating a duplicate.');
      error.status = 409;
      error.code = 'TEACHING_D07_DUPLICATE_DRAFT';
      error.courseId = existing.course_id;
      throw error;
    }

    const course = await repository.createDraft({ studentId: user.id, subject, title, inventory });
    const backgroundAnalysis = await autoQueueAuditAfterDraft(user, course.course_id);
    if (input.intake && typeof input.intake === 'object') {
      await submitIntake(user, course.course_id, input.intake);
    }
    return backgroundAnalysis ? { ...course, background_analysis: backgroundAnalysis } : course;
  }

  const listCourses = (user) => repository.listCourses(user.id);

  async function getSetup(user, id) {
    const setup = await repository.getSetup(user.id, id);
    const background = setup.backgroundAnalysis;
    const currentState = String(setup.course.state_version);
    const auditState = setup.curriculumAudit?.validation_metadata?.state_version == null
      ? null
      : String(setup.curriculumAudit.validation_metadata.state_version);
    const auditIsCurrent = Boolean(
      setup.curriculumAudit &&
      auditState === currentState &&
      setup.curriculumAudit.source_inventory_digest === sourceInventoryDigest(setup.sources)
    );
    return {
      ...setup,
      curriculumAudit: auditIsCurrent ? setup.curriculumAudit : null,
      backgroundAnalysis: background,
    };
  }

  async function addMaterials(user, courseId, input = {}) {
    const setup = await repository.getSetup(user.id, courseId);
    const materials = [
      ...(input.originalMaterials || []).map((material) =>
        validateSupplementaryMaterialInput({ ...material, sourceKind: 'PRIMARY_STUDY_NOTE' })
      ),
      ...(input.supplementaryMaterials || []).map((material) => validateSupplementaryMaterialInput(material)),
    ];
    if (!materials.length) {
      const error = new Error('At least one Course material is required.');
      error.status = 400;
      error.code = 'TEACHING_D07_MATERIAL_REQUIRED';
      throw error;
    }
    const added = await repository.addMaterials({
      studentId: user.id,
      courseId,
      expectedStateVersion: setup.course.state_version,
      materials,
    });
    const backgroundAnalysis = await autoQueueAuditAfterDraft(user, courseId);
    return { ...added, background_analysis: backgroundAnalysis };
  }

  async function removeMaterial(user, courseId, sourceContentItemId) {
    const setup = await repository.getSetup(user.id, courseId);
    const removed = await repository.removeMaterial({
      studentId: user.id,
      courseId,
      sourceContentItemId,
      expectedStateVersion: setup.course.state_version,
    });
    const backgroundAnalysis = await autoQueueAuditAfterDraft(user, courseId);
    return { ...removed, background_analysis: backgroundAnalysis };
  }

  async function submitIntake(user, courseId, input = {}) {
    const setup = await repository.getSetup(user.id, courseId);
    const intake = await repository.saveIntake({
      studentId: user.id,
      courseId,
      intake: normalizeIntake(input),
    });
    if (!intelligence) return { intake, extraction: null, extractionStatus: 'ROUTE_HELD_UNTIL_D30' };

    const result = await intelligence.extractIntake({ course: setup.course, intake });
    if (!result.accepted) return { intake, extraction: null, extractionStatus: 'REJECTED' };

    const output = result.validatedResult.output;
    const extraction = await repository.saveExtraction({
      studentId: user.id,
      intakeId: intake.intake_id,
      capabilityId: 'teaching.curriculum.intake_signal_extraction',
      contractVersion: 'd07.intake-extraction.v1',
      signals: {
        interaction_preferences: output.interaction_preferences,
        academic_self_report: output.academic_self_report,
        goals: output.goals,
        deadlines: output.deadlines,
        planning_hypotheses: output.planning_hypotheses,
        diagnostic_targets: output.diagnostic_targets,
        evidence_status: 'NON_EVIDENCE_PLANNING_HYPOTHESIS',
      },
      uncertainty: output.uncertainty,
      provenance: output.provenance,
    });
    const changed = [];
    if (output.diagnostic_targets.length) {
      changed.push(`Targeted diagnostic attention added for ${output.diagnostic_targets.join(', ')}.`);
    }
    if (output.interaction_preferences.length) {
      changed.push('Your interaction preferences will shape explanation and representation choices.');
    }
    if (output.planning_hypotheses.length) {
      changed.push('Reported academic concerns were retained as planning hypotheses for later verification.');
    }
    return {
      intake,
      extraction,
      extractionStatus: 'VALIDATED',
      planningExplanation: changed.join(' ') || 'Your Intake was preserved without changing academic scope or standards.',
    };
  }

  async function editPreferences(user, courseId, input) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => ![
        'explanation_pace',
        'example_first',
        'feedback_style',
        'explanation_length',
      ].includes(key))
    ) {
      const error = new Error('Only minor interaction preferences may be edited here; academic scope changes require Course Plan review.');
      error.status = 400;
      error.code = 'TEACHING_D07_MATERIAL_SCOPE_CHANGE_REQUIRES_PLAN_REVIEW';
      throw error;
    }
    return repository.updateInteractionPreferences({ studentId: user.id, courseId, preferences: input });
  }

  async function runAudit(user, courseId) {
    if (!intelligence) held();
    const setup = await repository.getSetup(user.id, courseId);
    const inputStateVersion = String(setup.course.state_version);
    const inputInventoryDigest = sourceInventoryDigest(setup.sources);

    const result = await intelligence.runCurriculumAudit({ course: setup.course, sources: setup.sources });
    if (!result.accepted) {
      const error = new Error('Curriculum Audit was rejected by validation.');
      error.status = 422;
      error.code = 'TEACHING_D07_CURRICULUM_AUDIT_REJECTED';
      throw error;
    }

    const current = await repository.getSetup(user.id, courseId);
    const currentStateVersion = String(current.course.state_version);
    const currentInventoryDigest = sourceInventoryDigest(current.sources);
    if (currentStateVersion !== inputStateVersion || currentInventoryDigest !== inputInventoryDigest) {
      const error = new Error('Course state changed while Curriculum Audit was running; analysis must restart from the current snapshot.');
      error.status = 409;
      error.code = 'TEACHING_D07_AUDIT_STATE_CHANGED';
      error.retryable = true;
      error.expectedStateVersion = inputStateVersion;
      error.currentStateVersion = currentStateVersion;
      throw error;
    }

    const output = result.validatedResult.output;
    return repository.saveAudit({
      studentId: user.id,
      courseId,
      subjectSnapshotRef: setup.course.subject_snapshot_ref,
      inventoryDigest: inputInventoryDigest,
      output,
      provenanceRefs: setup.sources.map((source) => `source:${source.source_content_item_id}`),
      validationMetadata: {
        schema: 'd07.curriculum-audit.v2',
        prompt_family: 'TPF-02',
        prompt_version: '1.1',
        output_schema_version: '2',
        lineage_reconciled: true,
        domain_validated: true,
        source_census: setup.sources.length,
        state_version: inputStateVersion,
      },
    });
  }

  async function queueAudit(user, courseId, {
    supersedeEventId = null,
    causationId = null,
  } = {}) {
    if (!intelligence) held();
    if (!outboxStore || typeof outboxStore.append !== 'function' || typeof randomUUID !== 'function') {
      queueUnavailable();
    }

    const setup = await repository.getSetup(user.id, courseId);
    const current = setup.backgroundAnalysis;
    const currentStatus = String(current?.status || '').toUpperCase();
    const supersededCurrent = Boolean(
      supersedeEventId && current?.event_id && String(current.event_id) === String(supersedeEventId)
    );
    if (['PENDING', 'CLAIMED', 'RETRY_WAIT'].includes(currentStatus) && !supersededCurrent) {
      return {
        accepted: true,
        background: true,
        jobId: current.event_id,
        status: current.status,
        joinedExisting: true,
      };
    }

    const now = clock().toISOString();
    const eventId = randomUUID();
    const baseKey = `d07:curriculum-audit:${courseId}:${setup.course.state_version}`;
    const idempotencyKey = supersededCurrent
      ? `${baseKey}:state-recovery:${current.event_id}`
      : currentStatus === 'CANCELLED'
        ? `${baseKey}:recovery:${current.event_id}`
        : baseKey;
    const effectiveCausationId = causationId || (
      supersededCurrent || currentStatus === 'CANCELLED' ? current?.event_id || null : null
    );

    const queued = await outboxStore.append({
      eventId,
      schemaVersion: 1,
      eventType: 'teaching.curriculum.audit_requested',
      eventCategory: 'operational_recovery_event',
      triggerType: 'background_analysis',
      source: 'teaching.d07',
      origin: supersededCurrent ? 'teaching.curriculum.audit_state_recovery' : 'teaching.course_setup',
      actorId: user.id,
      aggregateType: 'teaching_course',
      aggregateId: courseId,
      aggregateVersion: setup.course.state_version,
      occurredAt: now,
      effectiveAt: now,
      correlationId: eventId,
      causationId: effectiveCausationId,
      idempotencyKey,
      payload: {
        student_id: user.id,
        course_id: courseId,
        subject_snapshot_ref: setup.course.subject_snapshot_ref,
        source_inventory_digest: sourceInventoryDigest(setup.sources),
      },
      auditRefs: [],
      provenanceRefs: setup.sources.map((source) => `source:${source.source_content_item_id}`),
    });

    return {
      accepted: true,
      background: true,
      jobId: queued.event_id || eventId,
      status: queued.status || 'PENDING',
      joinedExisting: queued.inserted === false,
    };
  }

  async function getAnalysisStatus(user, courseId) {
    const setup = await repository.getSetup(user.id, courseId);
    const current = setup.backgroundAnalysis;
    if (!current) return { status: 'NOT_STARTED', background: true };
    return {
      status: current.status,
      background: true,
      jobId: current.event_id,
      attempts: current.attempt_count,
      nextAttemptAt: current.next_attempt_at,
      errorCode: current.error_code,
      errorMessage: current.error_message,
      staleReason: current.stale_reason,
    };
  }

  async function getAudit(user, courseId) {
    const setup = await repository.getSetup(user.id, courseId);
    return setup.curriculumAudit || null;
  }

  async function designDiagnostic(user, courseId) {
    if (!intelligence) held();
    const setup = await repository.getSetup(user.id, courseId);
    if (!setup.curriculumAudit) {
      const error = new Error('Complete Curriculum Audit before Diagnostic design.');
      error.status = 409;
      error.code = 'TEACHING_D07_AUDIT_REQUIRED';
      throw error;
    }
    const requirement = selectDiagnosticRequirement(setup.curriculumAudit.audit_output || {});
    const result = await intelligence.designDiagnostic({
      course: setup.course,
      requirement,
      audit: setup.curriculumAudit,
    });
    if (!result.accepted) {
      const error = new Error('Targeted Diagnostic could not be validated.');
      error.status = 422;
      error.code = 'TEACHING_D07_DIAGNOSTIC_REJECTED';
      throw error;
    }
    return repository.saveDiagnosticPlan({
      studentId: user.id,
      courseId,
      auditId: setup.curriculumAudit.curriculum_audit_id,
      requirementState: requirement.state,
      targetRefs: requirement.targets,
      output: result.validatedResult.output,
      provenanceRefs: [`curriculum-audit:${setup.curriculumAudit.curriculum_audit_id}`],
    });
  }

  async function submitDiagnosticAttempt(user, courseId, input = {}) {
    const setup = await repository.getSetup(user.id, courseId);
    if (!setup.diagnosticPlan) {
      const error = new Error('No active Targeted Diagnostic exists for this Course.');
      error.status = 409;
      error.code = 'TEACHING_D07_DIAGNOSTIC_REQUIRED';
      throw error;
    }
    const attempt = await repository.saveDiagnosticAttempt({
      studentId: user.id,
      courseId,
      diagnosticPlanId: setup.diagnosticPlan.diagnostic_plan_id,
      evidence: input.evidence,
      independentAttempt: true,
    });
    return attempt;
  }

  async function interpretDiagnosticAttempt(user, courseId, attemptId) {
    if (!intelligence) held();
    const setup = await repository.getSetup(user.id, courseId);
    const attempt = await repository.getDiagnosticAttempt(user.id, attemptId);
    if (!attempt || String(attempt.course_id) !== String(courseId)) {
      const error = new Error('Diagnostic Attempt not found.');
      error.status = 404;
      error.code = 'TEACHING_D07_DIAGNOSTIC_ATTEMPT_NOT_FOUND';
      throw error;
    }
    const target = {
      targetKind: 'learning_unit',
      targetRef: String(setup.diagnosticPlan?.target_refs?.[0] || 'course'),
    };
    const result = await intelligence.interpretPriorKnowledge({
      course: setup.course,
      target,
      evidenceRefs: [attempt.diagnostic_attempt_id],
    });
    if (!result.accepted) {
      const error = new Error('Validated Prior Knowledge interpretation could not be validated.');
      error.status = 422;
      error.code = 'TEACHING_D07_VPK_INTERPRETATION_REJECTED';
      throw error;
    }
    const output = result.validatedResult.output;
    const evaluated = evaluateValidatedPriorKnowledge({
      targetKind: target.targetKind,
      targetRef: target.targetRef,
      interpretation: output,
    });
    return repository.saveVpkDecision({
      studentId: user.id,
      courseId,
      targetKind: target.targetKind,
      targetRef: target.targetRef,
      status: evaluated.status,
      rationale: evaluated.rationale,
      evidenceRefs: [attempt.diagnostic_attempt_id],
      provenanceRefs: [`diagnostic-attempt:${attempt.diagnostic_attempt_id}`],
      sourceSnapshotRef: setup.course.subject_snapshot_ref,
    });
  }

  return Object.freeze({
    createCourse,
    listCourses,
    getSetup,
    addMaterials,
    removeMaterial,
    submitIntake,
    editPreferences,
    runAudit,
    queueAudit,
    getAnalysisStatus,
    getAudit,
    designDiagnostic,
    submitDiagnosticAttempt,
    interpretDiagnosticAttempt,
  });
}

module.exports = { createD07Service };
