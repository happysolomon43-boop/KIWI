'use strict';

const {
  normalizeIntake,
  buildSourceInventory,
  selectDiagnosticRequirement,
  evaluateValidatedPriorKnowledge,
  digest,
} = require('./contracts');
const { TPF02_FAMILY_VERSION, TPF02_OUTPUT_SCHEMA_VERSION } = require('./tpf02-direct');
const { currentValidatedAudit } = require('./audit-idempotency-service');
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
    if (
      setup.curriculumAudit ||
      !intelligence ||
      !background?.event_id ||
      !outboxStore ||
      typeof outboxStore.getById !== 'function' ||
      typeof outboxStore.append !== 'function' ||
      typeof randomUUID !== 'function'
    ) {
      return setup;
    }

    // Operational read-repair: a Curriculum Audit event can finish publication
    // after its Course state version has changed. PUBLISHED without an audit is
    // not success; nor is an active event bound to an older state version. When
    // either condition is observed, leave one idempotent replacement event for
    // the current state. This is outbox recovery only and does not mutate
    // academic truth.
    let eventRow = null;
    try {
      eventRow = await outboxStore.getById(background.event_id);
    } catch (error) {
      logger?.warn?.('[KIWI Teaching D07] Could not inspect background audit event for reconciliation.', {
        courseId: String(id),
        eventId: String(background.event_id),
        code: error?.code || null,
      });
      return setup;
    }
    if (!eventRow) return setup;

    const eventStatus = String(eventRow.status || background.status || '').toUpperCase();
    const eventStateVersion = eventRow.aggregate_version == null
      ? null
      : String(eventRow.aggregate_version);
    const currentStateVersion = String(setup.course.state_version);
    const stateChanged = eventStateVersion != null && eventStateVersion !== currentStateVersion;
    const publishedWithoutArtifact = eventStatus === 'PUBLISHED' && !setup.curriculumAudit;
    if (!stateChanged && !publishedWithoutArtifact) return setup;
    if (eventStatus === 'CANCELLED') return setup;

    try {
      const recovery = await requeueAuditForCurrentState(user, id, background.event_id);
      return {
        ...setup,
        backgroundAnalysis: {
          ...background,
          event_id: recovery.jobId,
          status: recovery.status,
          last_error_code: null,
          recovered_from_event_id: background.event_id,
          recovery_reason: stateChanged ? 'COURSE_STATE_CHANGED' : 'PUBLISHED_WITHOUT_AUDIT',
        },
      };
    } catch (error) {
      logger?.warn?.('[KIWI Teaching D07] Stale Curriculum Audit event could not be requeued yet.', {
        courseId: String(id),
        eventId: String(background.event_id),
        code: error?.code || null,
        message: String(error?.message || error).slice(0, 300),
      });
      return setup;
    }
  }

  async function submitIntake(user, courseId, input) {
    const intake = await repository.saveIntake({
      studentId: user.id,
      courseId,
      intake: normalizeIntake(input),
    });
    if (!intelligence) return { intake, extraction: null, extractionStatus: 'ROUTE_HELD_UNTIL_D30' };

    const setup = await repository.getSetup(user.id, courseId);
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

  async function runAudit(user, courseId, { regenerate = false, regenerationReason = null, previousAudit = null } = {}) {
    if (!intelligence) held();
    const setup = await repository.getSetup(user.id, courseId);
    const inputStateVersion = String(setup.course.state_version);
    const inputInventoryDigest = sourceInventoryDigest(setup.sources);
    const normalizedReason = String(regenerationReason || '').trim().slice(0, 1500);
    const regenerationBasis = previousAudit || (regenerate ? setup.curriculumAudit : null);

    const result = await intelligence.runCurriculumAudit({
      course: setup.course,
      sources: setup.sources,
      regenerationReason: regenerate ? normalizedReason : null,
      previousAudit: regenerate ? regenerationBasis : null,
    });
    if (!result.accepted) {
      const error = new Error('Curriculum Audit was rejected by validation.');
      error.status = 422;
      error.code = 'TEACHING_D07_CURRICULUM_AUDIT_REJECTED';
      throw error;
    }

    // A deep audit can legitimately run for minutes. Re-read authoritative
    // state before persistence so a result generated from an older Course/source
    // snapshot can never be committed after a concurrent Course mutation.
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
        schema: 'd07.curriculum-audit.v3',
        prompt_family: 'TPF-02',
        prompt_version: TPF02_FAMILY_VERSION,
        output_schema_version: TPF02_OUTPUT_SCHEMA_VERSION,
        lineage_reconciled: true,
        domain_validated: true,
        source_census: setup.sources.length,
        state_version: inputStateVersion,
        regeneration_requested: regenerate === true,
        regeneration_reason: regenerate && normalizedReason ? normalizedReason : null,
        supersedes_audit_id: regenerate ? regenerationBasis?.curriculum_audit_id || null : null,
        supersedes_audit_version: regenerate && regenerationBasis?.audit_version != null ? Number(regenerationBasis.audit_version) : null,
      },
    });
  }

  async function queueAudit(user, courseId, {
    supersedeEventId = null,
    causationId = null,
    regenerate = false,
    regenerationReason = null,
  } = {}) {
    if (!intelligence) held();
    if (!outboxStore || typeof outboxStore.append !== 'function' || typeof randomUUID !== 'function') {
      queueUnavailable();
    }

    let setup = await repository.getSetup(user.id, courseId);
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
        operation: current?.payload?.regenerate === true ? 'REGENERATION' : 'GENERATION',
      };
    }

    let regeneration = null;
    const normalizedReason = String(regenerationReason || '').trim().slice(0, 1500);
    if (regenerate) {
      if (typeof repository.prepareAuditRegeneration !== 'function') {
        const error = new Error('Course analysis regeneration reset is unavailable.');
        error.status = 503;
        error.code = 'TEACHING_D07_AUDIT_REGENERATION_RESET_UNAVAILABLE';
        throw error;
      }
      regeneration = await repository.prepareAuditRegeneration({
        studentId: user.id,
        courseId,
        reason: normalizedReason,
      });
      setup = await repository.getSetup(user.id, courseId);
    } else if ((currentStatus === 'PUBLISHED' && currentValidatedAudit(setup)) && !supersededCurrent) {
      return {
        accepted: true,
        background: false,
        status: 'COMPLETED',
        auditReady: true,
        auditVersion: Number(setup.curriculumAudit.audit_version),
      };
    }

    const now = clock().toISOString();
    const eventId = randomUUID();
    const priorAuditVersion = regenerate ? Number(regeneration?.previousAudit?.audit_version || 0) : 0;
    const modeKey = regenerate ? `:regenerate:from-audit-${priorAuditVersion}` : '';
    const baseKey = `d07:curriculum-audit:${courseId}:${setup.course.state_version}:tpf02:${TPF02_FAMILY_VERSION}${modeKey}`;
    const idempotencyKey = supersededCurrent
      ? `${baseKey}:state-recovery:${current.event_id}`
      : currentStatus === 'CANCELLED' && !regenerate
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
      origin: regenerate
        ? 'teaching.curriculum.audit_regeneration'
        : supersededCurrent
          ? 'teaching.curriculum.audit_state_recovery'
          : 'teaching.course_setup',
      actorId: String(user.id),
      aggregateType: 'teaching_course',
      aggregateId: String(courseId),
      aggregateVersion: Number(setup.course.state_version),
      occurredAt: now,
      correlationId: eventId,
      causationId: effectiveCausationId,
      idempotencyKey,
      payload: {
        course_id: String(courseId),
        expected_state_version: String(setup.course.state_version),
        regenerate: regenerate === true,
        regeneration_reason: regenerate && normalizedReason ? normalizedReason : null,
        previous_audit_id: regenerate ? regeneration?.previousAudit?.curriculum_audit_id || null : null,
        previous_audit_version: regenerate ? priorAuditVersion || null : null,
      },
      auditRefs: regenerate && regeneration?.previousAudit?.curriculum_audit_id
        ? [`curriculum-audit:${regeneration.previousAudit.curriculum_audit_id}`]
        : [],
      provenanceRefs: (setup.sources || []).map((source) => `source:${source.source_content_item_id}`),
    });
    return {
      accepted: true,
      background: true,
      jobId: queued.event.event_id,
      status: queued.event.status,
      joinedExisting: queued.inserted === false,
      operation: regenerate ? 'REGENERATION' : 'GENERATION',
      previousAuditVersion: regenerate ? priorAuditVersion || null : null,
      resetApplied: regenerate === true,
    };
  }

  async function requeueAuditForCurrentState(user, courseId, staleEventId) {
    if (!String(staleEventId || '').trim()) {
      const error = new TypeError('staleEventId is required for Curriculum Audit state recovery.');
      error.code = 'TEACHING_D07_STALE_AUDIT_EVENT_REQUIRED';
      throw error;
    }
    return queueAudit(user, courseId, {
      supersedeEventId: String(staleEventId),
      causationId: String(staleEventId),
    });
  }

  async function planDiagnostic(user, courseId, input = {}) {
    const setup = await repository.getSetup(user.id, courseId);
    const signals = input.intakeSignals || {};
    const deps = setup.curriculumAudit?.audit_output?.assumed_prerequisites || [];
    const requirement = selectDiagnosticRequirement({
      dependencies: deps,
      intakeSignals: signals,
      existingEvidence: input.existingEvidence || [],
    });
    if (!requirement.required) {
      return repository.saveDiagnosticPlan({
        studentId: user.id,
        courseId,
        auditId: setup.curriculumAudit?.curriculum_audit_id,
        requirement,
      });
    }
    if (!intelligence) held();
    const result = await intelligence.designDiagnostic({
      course: setup.course,
      requirement,
      audit: setup.curriculumAudit,
    });
    if (!result.accepted) {
      const error = new Error('Diagnostic design was rejected by validation.');
      error.status = 422;
      error.code = 'TEACHING_D07_DIAGNOSTIC_DESIGN_REJECTED';
      throw error;
    }
    return repository.saveDiagnosticPlan({
      studentId: user.id,
      courseId,
      auditId: setup.curriculumAudit?.curriculum_audit_id,
      requirement,
      design: result.validatedResult.output,
      provenanceRefs: [`curriculum-audit:${setup.curriculumAudit?.curriculum_audit_id}`],
    });
  }

  async function decideVpk(user, courseId, input = {}) {
    const setup = await repository.getSetup(user.id, courseId);
    if (!setup.course) throw new Error('Course not found.');
    const targetKind = String(input.targetKind || '').trim();
    const targetRef = String(input.targetRef || '').trim();
    if (!['PREREQUISITE', 'SOURCE_CONTENT_ITEM', 'LEARNING_UNIT'].includes(targetKind) || !targetRef) {
      const error = new Error('Valid targetKind and targetRef are required.');
      error.status = 400;
      throw error;
    }
    const requestedRefs = Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [];
    if (!requestedRefs.length) {
      const error = new Error('At least one server-held Diagnostic evidence reference is required.');
      error.status = 400;
      error.code = 'TEACHING_D07_VPK_EVIDENCE_REQUIRED';
      throw error;
    }
    const stored = await repository.loadDiagnosticEvidence({
      studentId: user.id,
      courseId,
      targetKind,
      targetRef,
      evidenceRefs: requestedRefs,
    });
    if (stored.length !== new Set(requestedRefs).size) {
      const error = new Error('Every VPK evidence reference must resolve to server-held Diagnostic evidence.');
      error.status = 422;
      error.code = 'TEACHING_D07_VPK_EVIDENCE_UNRESOLVED';
      throw error;
    }

    const design = setup.diagnosticPlan?.diagnostic_design || {};
    const evidence = stored.map((row) => ({
      evidenceRef: row.evidence_event_id,
      probeRef: row.response_quality?.probe_ref,
      independent: row.independent_performance === true,
      passed: row.response_quality?.passed === true,
      variedOrUncued: row.response_quality?.varied_or_uncued === true,
      criteriaPassed: row.response_quality?.criteria_passed || [],
    }));
    const validators = new Set(stored.map((row) =>
      `${String(row.response_quality?.validator_id || '').trim()}\u0000${String(row.response_quality?.validator_version || '').trim()}`
    ));
    if (
      validators.size !== 1 ||
      [...validators][0].startsWith('\u0000') ||
      [...validators][0].endsWith('\u0000')
    ) {
      const error = new Error('Diagnostic evidence must carry one consistent validator identity and version.');
      error.status = 422;
      error.code = 'TEACHING_D07_VPK_VALIDATOR_PROVENANCE_INVALID';
      throw error;
    }
    const [validatorId, validatorVersion] = [...validators][0].split('\u0000');
    const decision = evaluateValidatedPriorKnowledge({
      evidence,
      criticalCriteria: design.critical_criteria || [],
      constructSupportsVariation: design.construct_supports_variation !== false,
      unresolvedMaterialContradiction: stored.some((row) =>
        row.response_quality?.unresolved_material_contradiction === true
      ),
      validatorId,
      validatorVersion,
      provenanceRefs: stored.map((row) => `evidence:${row.evidence_event_id}`),
    });
    return repository.saveVpkDecision({ studentId: user.id, courseId, targetKind, targetRef, decision });
  }

  return Object.freeze({
    createCourse,
    listCourses,
    getSetup,
    submitIntake,
    editPreferences,
    runAudit,
    queueAudit,
    requeueAuditForCurrentState,
    planDiagnostic,
    decideVpk,
  });
}

module.exports = { createD07Service };
