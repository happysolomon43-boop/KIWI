'use strict';

const { buildSourceInventory, digest } = require('../d07/contracts');
const { getTeachingDecision } = require('../policy');
const {
  validateCoursePlanProposal,
  reconcileCoverage,
  buildCoverageReport,
  classifyScopeChange,
  buildPlanDiff,
  activationDecision,
  completionDecision,
  evaluateVpkContradiction,
} = require('./contracts');

function createD08Service({ subjects, d07Repository, repository, intelligence = null } = {}) {
  if (!subjects || typeof subjects.getCorpusForUser !== 'function') throw new TypeError('D08 service requires the authenticated KIWI Subject corpus interface.');
  if (!d07Repository || typeof d07Repository.getSetup !== 'function') throw new TypeError('D08 service requires the accepted D07 Course setup repository.');
  if (!repository) throw new TypeError('D08 service requires its D04-backed Course Plan/Coverage repository.');

  const policies = Object.freeze({
    sourceMeaningfulness: getTeachingDecision('TCH-0691').policy_version,
    validatedPriorKnowledge: getTeachingDecision('TCH-0692').policy_version,
    incompleteRequiredContent: getTeachingDecision('TCH-0693').policy_version,
    assessmentEligibilityExceptions: getTeachingDecision('TCH-0694').policy_version,
  });

  function routeHeld() {
    const error = new Error('Teaching AI routes remain UNQUALIFIED pending D30.');
    error.status = 503;
    error.code = 'TEACHING_ROUTE_UNQUALIFIED';
    throw error;
  }
  function inventoryDigest(sources) {
    return digest(sources.map((source) => [String(source.source_ref), String(source.content_hash)]));
  }
  function latestDecisionMap(decisions = []) {
    const map = new Map();
    for (const decision of [...decisions].sort((a, b) => String(a.decided_at || '').localeCompare(String(b.decided_at || '')))) {
      map.set(`${decision.target_kind}:${decision.target_ref}`, decision);
    }
    return map;
  }
  function unresolvedDiagnosticTargets(setup) {
    if (setup.diagnosticPlan?.requirement_state !== 'REQUIRED') return [];
    const latest = latestDecisionMap(setup.vpkDecisions);
    return (setup.diagnosticPlan.target_refs || []).map(String).filter((ref) => {
      return !latest.has(`PREREQUISITE:${ref}`) && !latest.has(`LEARNING_UNIT:${ref}`) && !latest.has(`SOURCE_CONTENT_ITEM:${ref}`);
    });
  }
  function assertPlanningPrerequisites(setup, bundle) {
    if (!setup.curriculumAudit || setup.curriculumAudit.status !== 'VALIDATED_CANDIDATE') {
      const error = new Error('A validated Curriculum Audit is required before Course Plan generation.');
      error.status = 409;
      error.code = 'TEACHING_D08_CURRICULUM_AUDIT_REQUIRED';
      throw error;
    }
    const digestNow = inventoryDigest(setup.sources);
    if (String(setup.curriculumAudit.source_inventory_digest) !== digestNow) {
      const error = new Error('The current source inventory is newer than the validated Curriculum Audit. Run Curriculum Audit review before creating a new Course Plan version.');
      error.status = 409;
      error.code = 'TEACHING_D08_CURRICULUM_AUDIT_STALE';
      throw error;
    }
    if (setup.sources.some((source) => !source.classification)) {
      const error = new Error('Every current source item must be classified by the validated Curriculum Audit before Course Planning.');
      error.status = 409;
      error.code = 'TEACHING_D08_SOURCE_CLASSIFICATION_UNRESOLVED';
      throw error;
    }
    if (!bundle.plan && (String(setup.course.lifecycle_state).toUpperCase() !== 'DRAFT' || setup.course.semester_id)) {
      const error = new Error('Course Plan version 1 must exist before Semester activation.');
      error.status = 409;
      error.code = 'TEACHING_D08_PLAN_V1_REQUIRED_BEFORE_ACTIVATION';
      throw error;
    }
    const unresolved = unresolvedDiagnosticTargets(setup);
    if (unresolved.length) {
      const error = new Error('Required placement/prior-knowledge Diagnostic evidence is still unresolved.');
      error.status = 409;
      error.code = 'TEACHING_D08_REQUIRED_DIAGNOSTIC_UNRESOLVED';
      error.unresolvedTargets = unresolved;
      throw error;
    }
    return digestNow;
  }

  async function generatePlan(user, courseId) {
    const setup = await d07Repository.getSetup(user.id, courseId);
    const bundle = await repository.getLatestPlanBundle(user.id, courseId);
    const sourceInventoryDigest = assertPlanningPrerequisites(setup, bundle);
    if (!intelligence) routeHeld();
    const result = await intelligence.generateCoursePlan({
      course: setup.course,
      audit: setup.curriculumAudit,
      sources: setup.sources,
      vpkDecisions: setup.vpkDecisions,
      intake: setup.intake,
      previousPlan: bundle.plan,
    });
    if (!result?.accepted) {
      const error = new Error('Course Plan proposal was rejected by Teaching validation.');
      error.status = 422;
      error.code = 'TEACHING_D08_COURSE_PLAN_REJECTED';
      throw error;
    }
    const validation = validateCoursePlanProposal(result.validatedResult?.output, {
      audit: setup.curriculumAudit,
      sourceItems: setup.sources,
      vpkDecisions: setup.vpkDecisions,
    });
    if (!validation.ok) {
      const error = new Error('Course Plan proposal failed deterministic domain validation.');
      error.status = 422;
      error.code = validation.reason || 'TEACHING_D08_COURSE_PLAN_REJECTED';
      throw error;
    }
    const scopeDiffSummary = buildPlanDiff(bundle, validation.value);
    const generationProvenance = {
      capability_id: 'teaching.curriculum.course_plan_generation',
      prompt_family_id: 'TPF-03',
      prompt_family_version: '1.0',
      authority_ceiling: 'T3',
      output_schema_version: 'd08.course-plan.v1',
      curriculum_audit_id: setup.curriculumAudit.curriculum_audit_id,
      curriculum_audit_version: setup.curriculumAudit.audit_version,
      vpk_decision_refs: setup.vpkDecisions.map((decision) => decision.vpk_decision_id),
      intake_ref: setup.intake?.intake_id || null,
      source_inventory_digest: sourceInventoryDigest,
      route_qualification: 'UNQUALIFIED_UNTIL_D30',
      provenance_refs: [
        `curriculum-audit:${setup.curriculumAudit.curriculum_audit_id}`,
        ...setup.sources.map((source) => `source:${source.source_content_item_id}`),
        ...setup.vpkDecisions.map((decision) => `vpk:${decision.vpk_decision_id}`),
      ],
    };
    const plan = await repository.createPlanVersion({
      studentId: user.id,
      course: setup.course,
      setup,
      plan: validation.value,
      scopeChecksum: validation.scopeChecksum,
      sourceInventoryDigest,
      generationProvenance,
      scopeDiffSummary,
    });
    const coverage = await auditCoverage(user, courseId, 'PRE_ACTIVATION');
    return { plan, coverage };
  }

  function publicPlan(bundle) {
    if (!bundle.plan) return null;
    const subs = new Map();
    for (const subtopic of bundle.subtopics) {
      const rows = subs.get(subtopic.topic_id) || [];
      rows.push(subtopic);
      subs.set(subtopic.topic_id, rows);
    }
    const byTopic = new Map();
    const bySubtopic = new Map();
    for (const unit of bundle.learningUnits) {
      const target = unit.subtopic_id ? bySubtopic : byTopic;
      const key = unit.subtopic_id || unit.topic_id;
      const rows = target.get(key) || [];
      rows.push(unit);
      target.set(key, rows);
    }
    const unitView = (unit) => ({
      title: unit.title,
      intendedCompetence: unit.intended_competence,
      exitConditions: unit.exit_conditions,
      criticality: unit.criticality,
      foundational: unit.foundational === true,
      instructionalLoadMinutes: { min: unit.instructional_load_min_minutes, max: unit.instructional_load_max_minutes },
      instructionalMode: unit.metadata?.instructional_mode || 'STANDARD',
      laterAssessmentBasis: unit.metadata?.later_assessment_basis || null,
      planningAttention: unit.metadata?.planning_attention || [],
    });
    return Object.freeze({
      version: bundle.plan.version_no,
      state: bundle.plan.plan_state,
      summary: bundle.plan.review_summary,
      scopeDiff: bundle.plan.scope_diff_summary || {},
      topics: bundle.topics.map((topic) => ({
        title: topic.title,
        learningUnits: (byTopic.get(topic.topic_id) || []).map(unitView),
        subtopics: (subs.get(topic.topic_id) || []).map((subtopic) => ({
          title: subtopic.title,
          learningUnits: (bySubtopic.get(subtopic.subtopic_id) || []).map(unitView),
        })),
      })),
      assumedPrerequisites: bundle.prerequisites.map((item) => ({ disclosure: item.disclosure, validationStatus: item.validation_status })),
    });
  }

  async function getReview(user, courseId) {
    const setup = await d07Repository.getSetup(user.id, courseId);
    const bundle = await repository.getLatestPlanBundle(user.id, courseId);
    if (!bundle.plan) {
      return Object.freeze({
        course: { title: setup.course.title, lifecycleState: setup.course.lifecycle_state },
        stage: 'DEEP_SOURCE_ANALYSIS_SCOPE_AND_COVERAGE_MAPPING',
        curriculumAudit: setup.curriculumAudit ? { status: setup.curriculumAudit.status, version: setup.curriculumAudit.audit_version } : null,
        plan: null,
        coverage: buildCoverageReport({
          sourceItems: setup.sources,
          reconciliation: { stage: 'PRE_ACTIVATION', status: 'BLOCKED', unresolved: setup.sources.filter((source) => source.classification === 'ACADEMICALLY_MEANINGFUL').map((source) => ({ label: source.content_summary || source.source_ref })), incomplete: [], totals: { required: setup.sources.filter((source) => source.classification === 'ACADEMICALLY_MEANINGFUL').length } },
          scopeChanges: bundle.scopeChanges,
          prerequisites: [],
        }),
        scopeChanges: [],
        protections: { intakeIsEvidence: false, coverageIsMastery: false, rawSubjectScopeIsAssessmentEligibility: false, aiRouteQualification: 'UNQUALIFIED_UNTIL_D30' },
      });
    }
    const reconciliation = reconcileCoverage({
      sourceItems: setup.sources,
      mappings: bundle.mappings,
      exclusions: bundle.exclusions.map((item) => ({ ...item, approved: true })),
      coverageRows: bundle.coverage,
      learningUnits: bundle.learningUnits,
      stage: 'PRE_ACTIVATION',
    });
    return Object.freeze({
      course: { title: setup.course.title, lifecycleState: setup.course.lifecycle_state },
      stage: 'DEEP_SOURCE_ANALYSIS_SCOPE_AND_COVERAGE_MAPPING',
      curriculumAudit: setup.curriculumAudit ? { status: setup.curriculumAudit.status, version: setup.curriculumAudit.audit_version, sourceInventoryDigest: setup.curriculumAudit.source_inventory_digest } : null,
      plan: publicPlan(bundle),
      coverage: buildCoverageReport({ sourceItems: setup.sources, reconciliation, scopeChanges: bundle.scopeChanges, prerequisites: bundle.prerequisites }),
      scopeChanges: bundle.scopeChanges.map((change) => ({ classification: change.change_classification, requiresPlanVersion: change.requires_plan_version, applied: change.applied === true, summary: change.student_summary, detectedAt: change.detected_at })),
      protections: { intakeIsEvidence: false, coverageIsMastery: false, rawSubjectScopeIsAssessmentEligibility: false, aiRouteQualification: 'UNQUALIFIED_UNTIL_D30' },
    });
  }

  async function auditCoverage(user, courseId, stage = 'PRE_ACTIVATION') {
    const setup = await d07Repository.getSetup(user.id, courseId);
    const bundle = await repository.getLatestPlanBundle(user.id, courseId);
    if (!bundle.plan) {
      const error = new Error('Course Plan is required before Coverage Audit.');
      error.status = 409;
      error.code = 'TEACHING_D08_COURSE_PLAN_REQUIRED';
      throw error;
    }
    const reconciliation = reconcileCoverage({
      sourceItems: setup.sources,
      mappings: bundle.mappings,
      exclusions: bundle.exclusions.map((item) => ({ ...item, approved: true })),
      coverageRows: bundle.coverage,
      learningUnits: bundle.learningUnits,
      stage: stage === 'END_OF_COURSE' ? 'END_OF_COURSE' : 'PRE_ACTIVATION',
    });
    const report = buildCoverageReport({ sourceItems: setup.sources, reconciliation, scopeChanges: bundle.scopeChanges, prerequisites: bundle.prerequisites });
    const studentSummary = reconciliation.status === 'PASS'
      ? (reconciliation.stage === 'PRE_ACTIVATION' ? 'All required course content is mapped before activation.' : 'All required course content is instructionally complete through teaching or validated prior knowledge.')
      : (reconciliation.stage === 'PRE_ACTIVATION' ? 'Course activation is blocked until every required content item is mapped.' : 'Normal completion is blocked because required curriculum remains instructionally incomplete.');
    const coverageAudit = await repository.saveCoverageAudit({ studentId: user.id, courseId, coursePlanId: bundle.plan.course_plan_id, reconciliation, studentSummary });
    return Object.freeze({
      coverageAudit,
      report,
      gate: reconciliation.stage === 'PRE_ACTIVATION' ? activationDecision({ reconciliation, learningUnits: bundle.learningUnits }) : completionDecision({ reconciliation }),
      separation: { curriculumCoverageIsNotVerifiedMastery: true },
    });
  }

  async function detectScopeChange(user, courseId) {
    const setup = await d07Repository.getSetup(user.id, courseId);
    const corpus = await subjects.getCorpusForUser(user.id, setup.course.subject_id);
    const supplementaryMaterials = setup.sources.filter((source) => ['STUDENT_SUPPLEMENT', 'AUTHORITATIVE_SCHOOL_SCOPE'].includes(source.source_kind)).map((source) => ({
      sourceKind: source.source_kind,
      sourceRef: source.source_ref,
      versionRef: source.source_version_ref,
      content: source.content_summary || source.source_ref,
      locator: source.locator || {},
    }));
    const candidateInventory = buildSourceInventory({ corpus, supplementaryMaterials });
    const candidateSources = candidateInventory.items.map((item) => {
      const prior = setup.sources.find((source) => source.source_kind === item.sourceKind && source.source_ref === item.sourceRef && source.content_hash === item.contentHash);
      return { source_ref: item.sourceRef, source_kind: item.sourceKind, source_version_ref: item.sourceVersionRef, content_hash: item.contentHash, classification: prior?.classification || null, academically_meaningful: prior?.academically_meaningful ?? null };
    });
    const classification = classifyScopeChange({ currentSources: setup.sources, candidateSources, courseLifecycle: setup.course.lifecycle_state });
    if (classification.classification === 'NONE') return Object.freeze({ changed: false, classification: 'NONE', requiresPlanVersion: false, summary: 'No reviewed Course scope change was detected.' });
    const studentSummary = classification.requiresPlanVersion
      ? 'New or changed authoritative material was detected. The current Course Plan stays historically intact while the changed scope is re-audited and reviewed in a new Course Plan version.'
      : 'A supplementary metadata update was recorded without changing required Course scope.';
    const record = await repository.recordScopeChange({ studentId: user.id, course: setup.course, candidateInventory, classification, studentSummary });
    return Object.freeze({ changed: true, classification: record.change_classification, requiresPlanVersion: record.requires_plan_version, summary: record.student_summary, nextStep: record.requires_plan_version ? 'RUN_CURRICULUM_AUDIT_THEN_CREATE_NEW_COURSE_PLAN_VERSION' : 'NO_FORMAL_PLAN_VERSION_REQUIRED', aiImpactStatus: record.requires_plan_version && !intelligence ? 'ROUTE_HELD_UNTIL_D30' : 'OPTIONAL_PROVISIONAL_IMPACT_ANALYSIS' });
  }

  async function recordVpkContradiction(user, courseId, input = {}) {
    const setup = await d07Repository.getSetup(user.id, courseId);
    const targetKind = String(input.targetKind || '').trim();
    const targetRef = String(input.targetRef || '').trim();
    const evidenceRefs = Array.isArray(input.evidenceRefs) ? [...new Set(input.evidenceRefs.map(String))] : [];
    if (!['PREREQUISITE', 'SOURCE_CONTENT_ITEM', 'LEARNING_UNIT'].includes(targetKind) || !targetRef || !evidenceRefs.length) {
      const error = new Error('Valid targetKind, targetRef and controlled evidenceRefs are required.');
      error.status = 400;
      throw error;
    }
    const current = [...setup.vpkDecisions].filter((decision) => decision.target_kind === targetKind && String(decision.target_ref) === targetRef).sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')))[0];
    if (!current || current.decision_status !== 'VALIDATED_PRIOR_KNOWLEDGE') {
      const error = new Error('No current Validated Prior Knowledge decision exists for this target.');
      error.status = 409;
      error.code = 'TEACHING_D08_CURRENT_VPK_REQUIRED';
      throw error;
    }
    const rows = await repository.loadControlledVpkEvidence({ studentId: user.id, courseId, targetKind, targetRef, evidenceRefs });
    if (rows.length !== evidenceRefs.length) {
      const error = new Error('Every contradiction reference must resolve to server-held controlled evidence for the target.');
      error.status = 422;
      error.code = 'TEACHING_D08_VPK_CONTRADICTION_EVIDENCE_UNRESOLVED';
      throw error;
    }
    const validators = new Set(rows.map((row) => `${String(row.response_quality?.validator_id || '').trim()}\u0000${String(row.response_quality?.validator_version || '').trim()}`));
    if (validators.size !== 1 || [...validators][0].startsWith('\u0000') || [...validators][0].endsWith('\u0000')) {
      const error = new Error('Controlled contradiction evidence requires one consistent validator identity and version.');
      error.status = 422;
      error.code = 'TEACHING_D08_VPK_CONTRADICTION_VALIDATOR_INVALID';
      throw error;
    }
    const [validatorId, validatorVersion] = [...validators][0].split('\u0000');
    const downgrade = evaluateVpkContradiction({
      currentDecision: current,
      validatorId,
      validatorVersion,
      evidence: rows.map((row) => ({ evidenceRef: row.evidence_event_id, probeRef: row.response_quality?.probe_ref, controlled: row.response_quality?.controlled_for_vpk_recheck === true, independent: row.independent_performance === true, contradicts: row.response_quality?.contradicts_validated_prior_knowledge === true })),
    });
    if (!downgrade.changed) return Object.freeze({ changed: false, currentDecision: current });
    const decision = await repository.appendVpkDowngrade({ studentId: user.id, courseId, currentDecision: current, downgrade });
    return Object.freeze({ changed: true, decision, consequence: 'Future Course Plan/Coverage reconciliation must stop using VPK compression for this target; historical evidence and prior decisions remain unchanged.' });
  }

  return Object.freeze({ generatePlan, getReview, auditCoverage, detectScopeChange, recordVpkContradiction, policies });
}

module.exports = { createD08Service };
