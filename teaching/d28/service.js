'use strict';
const { createD28PolicyConfig, D28_CONTRACT_VERSION, INTERACTION_LATENCY_BUDGETS_MS } = require('./contracts');
const { analyzePackage, evaluateDifGate, equatingClaimGate } = require('./item-analytics');
const { createPplBudgetState, decidePplExecution, buildPplProvenance } = require('./ppl-governance');
const { assertTrustedBackendAction, sanitizeStructuredContent, validateMaterialUpload } = require('./security');

function createD28Service({ repository, env = process.env } = {}) {
  if (!repository) throw new TypeError('D28 service requires repository.');
  const policies = createD28PolicyConfig(env);

  function status() {
    return Object.freeze({
      contractVersion: D28_CONTRACT_VERSION,
      taskCount: 39,
      academicTruthOwner: false,
      hiddenReasoningStored: false,
      centralAiRoutingOnly: true,
      promptBytesChanged: false,
      tpf20Qualified: false,
      productionReleaseAuthorized: false,
      latencyBudgets: INTERACTION_LATENCY_BUDGETS_MS,
      policies,
    });
  }

  async function recordOperation(input) {
    const latencyBudgetMs = INTERACTION_LATENCY_BUDGETS_MS[input.interactionType] || null;
    const eventId = await repository.recordOperationalEvent({
      ...input,
      metadata: { ...(input.metadata || {}), latencyBudgetMs },
    });
    if (latencyBudgetMs && Number(input.latencyMs) > latencyBudgetMs) {
      await repository.createAlert({
        alertType: 'LATENCY_BUDGET_EXCEEDED',
        severity: 'WARNING',
        correlationId: input.correlationId,
        sourceRef: input.source?.entityId || null,
        reasonCode: input.interactionType,
        details: { observedLatencyMs: Number(input.latencyMs), budgetMs: latencyBudgetMs },
      });
    }
    return Object.freeze({ eventId, latencyBudgetMs, academicMutation: false });
  }

  async function reportAssessmentValidationFailure(input = {}) {
    await repository.createAlert({
      alertType: 'ASSESSMENT_PACKAGE_VALIDATION_FAILURE',
      severity: 'CRITICAL',
      correlationId: input.correlationId,
      sourceRef: input.assessmentPackageId,
      reasonCode: input.reasonCode || 'PACKAGE_VALIDATION_FAILED',
      details: {
        assessmentId: input.assessmentId,
        packageVersion: input.packageVersion,
        automaticAcademicMutation: false,
      },
    });
    return recordOperation({
      category: 'ASSESSMENT',
      eventName: 'assessment_package_validation_failure',
      severity: 'CRITICAL',
      correlationId: input.correlationId,
      source: {
        owner: 'ASSESSMENT',
        entityType: 'AssessmentPackage',
        entityId: input.assessmentPackageId,
        version: input.packageVersion,
      },
      outcome: 'REJECTED',
      metadata: { reasonCode: input.reasonCode || 'PACKAGE_VALIDATION_FAILED' },
    });
  }

  async function reportMarkingDisagreement(input = {}) {
    await repository.createAlert({
      alertType: 'ABNORMAL_MARKING_DISAGREEMENT',
      severity: input.severity || 'WARNING',
      correlationId: input.correlationId,
      sourceRef: input.markingRunId,
      reasonCode: input.reasonCode || 'MARKING_DISAGREEMENT',
      details: {
        assessmentAttemptId: input.assessmentAttemptId,
        moderationRunId: input.moderationRunId || null,
        automaticMarkChange: false,
        requiresOwningDomainReview: true,
      },
    });
    return recordOperation({
      category: 'MODERATION',
      eventName: 'marking_disagreement_detected',
      severity: input.severity || 'WARNING',
      correlationId: input.correlationId,
      source: {
        owner: 'GRADEBOOK',
        entityType: 'MarkingRun',
        entityId: input.markingRunId,
        version: input.markingRunVersion,
      },
      outcome: 'REVIEW_REQUIRED',
      metadata: { reasonCode: input.reasonCode || 'MARKING_DISAGREEMENT' },
    });
  }

  async function reportAssessmentSyncFailure(input = {}) {
    await repository.createAlert({
      alertType: 'FORMAL_ASSESSMENT_SYNC_FAILURE',
      severity: 'CRITICAL',
      correlationId: input.correlationId,
      sourceRef: input.attemptId,
      reasonCode: input.reasonCode || 'SYNC_FAILURE',
      details: { assessmentId: input.assessmentId, attemptId: input.attemptId, serverAccepted: false },
    });
    return recordOperation({
      category: 'AUTOSAVE',
      eventName: 'assessment_sync_failure',
      severity: 'CRITICAL',
      correlationId: input.correlationId,
      source: {
        owner: 'ASSESSMENT_ATTEMPT',
        entityType: 'AssessmentAttempt',
        entityId: input.attemptId,
        version: input.attemptVersion,
      },
      outcome: 'FAILED',
      metadata: { reasonCode: input.reasonCode },
    });
  }

  async function recordQualitySample(input = {}) {
    for (const key of ['rawStudentContent', 'studentResponse', 'responseText', 'answerText']) {
      if (input[key] != null) {
        const error = new Error('D28 quality sampling stores references and validation state, not raw student content.');
        error.code = 'TEACHING_D28_QUALITY_SAMPLE_RAW_CONTENT_FORBIDDEN';
        throw error;
      }
    }
    const sampleRefId = await repository.recordQualitySampleRef({
      sampleKind: input.sampleKind,
      sourceOwner: input.sourceOwner,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      sourceVersion: input.sourceVersion,
      correlationId: input.correlationId || null,
      samplingReason: input.samplingReason,
      validationState: input.validationState,
    });
    return Object.freeze({ sampleRefId, rawStudentContentStored: false, academicMutation: false });
  }

  async function operationalDashboard(actor, { hours = 24 } = {}) {
    if (!actor?.is_admin && !actor?.isAdmin && !actor?.supportRole) {
      throw Object.assign(new Error('Operational dashboard requires support/admin authorization.'), {
        code: 'TEACHING_D28_SUPPORT_FORBIDDEN',
        status: 403,
      });
    }
    return repository.dashboard(hours);
  }

  async function runItemAnalytics(input = {}) {
    const result = analyzePackage({
      packageRef: input.packageRef,
      items: input.items || [],
      policy: policies.itemAnalytics,
    });
    const runId = await repository.beginAnalyticsRun({
      ...input.packageRef,
      policyVersion: policies.itemAnalytics.version,
      samplePolicyRef: input.samplePolicyRef || policies.itemAnalytics.version,
      administrationContext: input.administrationContext || {},
      sampleSize: result.sampleSize,
    });
    await repository.persistAnalyticsResult(runId, result);
    for (const item of result.itemResults) {
      if (!item.reviewFlags.length) continue;
      await repository.createAlert({
        alertType: 'ASSESSMENT_ITEM_ANALYTICS_REVIEW',
        severity: 'WARNING',
        correlationId: runId,
        sourceRef: item.lineage.packageItemId,
        reasonCode: item.reviewFlags.join(','),
        details: {
          automaticInvalidation: false,
          automaticMarkChange: false,
          route: 'TPF-14_POST_EXPOSURE_REPAIR_IF_MATERIAL',
        },
      });
    }
    return Object.freeze({
      runId,
      result,
      dif: evaluateDifGate({
        enabled: policies.itemAnalytics.difEnabled,
        groupCounts: input.groupCounts || [],
        minGroupN: policies.itemAnalytics.difMinGroupN,
      }),
      equating: equatingClaimGate(input.equating || {}),
    });
  }

  async function decidePpl(input = {}) {
    const state = input.state || createPplBudgetState(policies.ppl);
    const decision = decidePplExecution({ ...input, state, policy: policies.ppl });
    const provenance = buildPplProvenance(input.provenance || {});
    await repository.recordPplBudget({
      workspaceId: input.workspaceId,
      workspaceVersion: input.workspaceVersion,
      policyVersion: policies.ppl.version,
      routePosture: input.routePosture,
      disposition: decision.disposition,
      materialNoop: decision.disposition === 'NO_OP_NO_MATERIAL_CHANGE',
      modelCalls: input.delta?.modelCalls || 0,
      totalTokens: input.delta?.totalTokens || 0,
      estimatedCostMicrounits: input.delta?.estimatedCostMicrounits,
      latencyMs: input.provenance?.latencyMs,
      provenance,
    });
    return Object.freeze({ decision, provenance });
  }

  async function suppressArtifact(user, input = {}) {
    if (String(user?.id) !== String(input.studentId || user?.id)) {
      throw Object.assign(new Error('Artifact visibility control is student-scoped.'), {
        code: 'TEACHING_D28_ARTIFACT_SCOPE_FORBIDDEN',
        status: 403,
      });
    }
    const controlId = await repository.createVisibilityControl({
      ...input,
      studentId: String(user.id),
      visibilityState: 'SUPPRESSED',
    });
    await repository.recordRetentionAction({
      policyVersion: policies.retention.version,
      studentId: String(user.id),
      artifactType: input.artifactType,
      artifactId: input.artifactId,
      actionKind: 'SUPPRESS_STUDENT_FACING_ARTIFACT',
      preservedAcademicLineage: true,
      reasonCode: input.reasonCode || 'STUDENT_DISMISSED',
    });
    return Object.freeze({
      controlId,
      studentFacingAvailable: false,
      academicHistoryDeleted: false,
      gradebookDeleted: false,
      auditDeleted: false,
    });
  }

  async function stageRollout(actor, input = {}) {
    assertTrustedBackendAction('REQUEST_APPLY', { ...actor, trustedBackend: actor?.trustedBackend === true });
    const changeKind = String(input.changeKind || '').toUpperCase();
    if (!['PROMPT', 'MODEL_ROUTE', 'POLICY'].includes(changeKind)) {
      throw Object.assign(new Error('Unsupported D28 rollout kind.'), { code: 'TEACHING_D28_ROLLOUT_KIND_INVALID' });
    }
    return repository.stageRollout({
      ...input,
      changeKind,
      policyVersion: policies.rollout.version,
      authorizedBy: actor?.id || 'trusted-backend',
    });
  }

  async function rollback(actor, rolloutId, state, reason) {
    assertTrustedBackendAction('REQUEST_APPLY', { ...actor, trustedBackend: actor?.trustedBackend === true });
    return repository.transitionRollout(rolloutId, state, 'ROLLED_BACK', reason || 'OPERATIONAL_ROLLBACK');
  }

  return Object.freeze({
    status,
    recordOperation,
    reportAssessmentValidationFailure,
    reportMarkingDisagreement,
    reportAssessmentSyncFailure,
    recordQualitySample,
    operationalDashboard,
    runItemAnalytics,
    decidePpl,
    suppressArtifact,
    stageRollout,
    rollback,
    sanitizeStructuredContent,
    validateMaterialUpload,
    policies,
  });
}

module.exports = { createD28Service };
