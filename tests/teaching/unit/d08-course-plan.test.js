'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contracts = require('../../../teaching/d08/contracts');
const canonical = require('../../../teaching/d08/canonical-plan');
const { boundedPlanningSignals, coursePlanRequest, scopeChangeImpactRequest, createD08Intelligence } = require('../../../teaching/d08/intelligence');
const { createD08Service } = require('../../../teaching/d08/service');

function sources() {
  return [
    { source_content_item_id: 's1', source_ref: 'source:1', source_kind: 'PRIMARY_KIWI_SUBJECT', classification: 'ACADEMICALLY_MEANINGFUL', academically_meaningful: true, discovered_at: new Date('2026-01-01') },
    { source_content_item_id: 's2', source_ref: 'source:2', source_kind: 'PRIMARY_KIWI_SUBJECT', classification: 'DUPLICATE', classification_reason: 'Same academic content as source:1', academically_meaningful: false, discovered_at: new Date('2026-01-01') },
  ];
}

function domainPlan(overrides = {}) {
  return {
    summary: 'Plan summary',
    topics: [{ key: 't1', title: 'Core topic', subtopics: [{ key: 'st1', title: 'Subtopic' }] }],
    learning_units: [{
      key: 'u1', topic_key: 't1', subtopic_key: 'st1', title: 'Core unit',
      intended_competence: 'Solve representative problems independently and explain the method.',
      exit_conditions: [{ criterion: 'Solve an unseen representative problem independently.', evidence_form: 'OBSERVABLE_PERFORMANCE', independence_required: true }],
      criticality: 'FOUNDATIONAL', foundational: true, instructional_load_min_minutes: 20, instructional_load_max_minutes: 45,
      instructional_treatment: 'FULL_INSTRUCTION', vpk_basis_refs: [],
    }],
    dependencies: [],
    source_mappings: [{ source_ref: 'source:1', learning_unit_keys: ['u1'] }, { source_ref: 'source:2', learning_unit_keys: [] }],
    assumed_prerequisites: [],
    learning_unit_lineage: [],
    ...overrides,
  };
}

function audit() {
  return {
    curriculum_audit_id: 'a1',
    status: 'VALIDATED_CANDIDATE',
    subject_snapshot_ref: 'snapshot:1',
    source_inventory_digest: 'digest:1',
    audit_output: {
      topics: [{ id: 't1', title: 'Core topic', subtopics: [{ id: 'st1', title: 'Subtopic' }] }],
      learning_units: [{
        id: 'u1', topic_id: 't1', subtopic_id: 'st1', title: 'Core unit',
        intended_competence: 'Solve representative problems independently and explain the method.',
        exit_conditions: [{ criterion: 'Solve an unseen representative problem independently.', evidence_form: 'OBSERVABLE_PERFORMANCE', independence_required: true }],
        criticality: 'FOUNDATIONAL', foundational: true, instructional_load_min_minutes: 20, instructional_load_max_minutes: 45,
      }],
      dependencies: [],
      source_accounting: [
        { source_ref: 'source:1', classification: 'ACADEMICALLY_MEANINGFUL', learning_unit_ids: ['u1'] },
        { source_ref: 'source:2', classification: 'DUPLICATE', learning_unit_ids: [] },
      ],
      assumed_prerequisites: [],
      likely_misconceptions: [],
    },
  };
}

function tpf03Output(overrides = {}) {
  return {
    status: 'ok',
    input_state_reference: { aggregate_type: 'teaching_course', aggregate_id: 'c1', state_version: '1' },
    review_required: false,
    review_reasons: [],
    plan_basis: {
      course_scope_version: 'snapshot:1',
      curriculum_artifact_version: 'a1',
      evidence_state_version: 'e1',
      policy_refs: ['source-meaningfulness.v1'],
      capacity_or_deadline_facts_used: [],
    },
    planning_principles_applied: ['Preserve required curriculum.'],
    course_sequence: [{
      sequence_group: 1,
      topic_or_phase: 'Core topic',
      learning_units: [{
        learning_unit_ref: 'u1',
        required_scope: true,
        initial_instruction_status: 'teach_full',
        initial_treatment_basis: 'Validated curriculum scope.',
        prerequisite_repair_refs: [],
        follow_up_treatments: ['review_retrieval'],
        prerequisite_refs: [],
        instructional_emphasis: 'high',
        emphasis_basis: 'Foundational dependency.',
        evidence_goal: 'Independent solution and explanation.',
        review_or_retention_notes: null,
        student_intake_accommodation_notes: 'Worked examples may support delivery without changing standards.',
      }],
    }],
    prerequisite_repairs: [],
    assessment_window_proposals: [],
    coverage_treatment_map: [{
      required_source_or_unit_ref: 'source:1',
      planned_treatment_refs: ['u1'],
      mapping_completeness_proposal: 'full',
      coverage_status_claimed: 'planned_only',
    }],
    infeasibility_or_pressure: [],
    unresolved_items: [],
    student_facing_plan_summary_candidate: 'The plan preserves the full validated course scope.',
    ...overrides,
  };
}

test('D08 has the seven required curriculum-profile fixtures', () => {
  const profiles = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/d08/curriculum-profiles.json'), 'utf8'));
  assert.equal(profiles.length, 7);
  assert.deepEqual(profiles.map((x) => x.discipline), ['mathematics','biology','chemistry','history','literature','computer science','mixed-profile']);
});

test('Course Plan validation accounts for every required meaningful source', () => {
  const result = contracts.validateCoursePlanProposal(domainPlan(), { sources: sources() });
  assert.equal(result.ok, true);
  assert.equal(result.value.source_mappings.length, 2);
});

test('Coverage Invariant rejects one silently unmapped required source', () => {
  const result = contracts.validateCoursePlanProposal(domainPlan({ source_mappings: [{ source_ref: 'source:2', learning_unit_keys: [] }] }), { sources: sources() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED');
});

test('every excluded source requires an explicit validated reason', () => {
  const input = sources();
  input[1] = { ...input[1], classification_reason: '' };
  const result = contracts.validateCoursePlanProposal(domainPlan(), { sources: input });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TEACHING_D08_EXCLUSION_REASON_REQUIRED');
});

test('foundational Learning Units require a meaningful independent exit condition', () => {
  const plan = domainPlan();
  plan.learning_units[0] = { ...plan.learning_units[0], exit_conditions: [{ criterion: 'Can explain the method accurately.', evidence_form: 'ORAL_EXPLANATION', independence_required: false }] };
  const result = contracts.validateCoursePlanProposal(plan, { sources: sources() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TEACHING_D08_CRITICAL_EXIT_CONDITION_REQUIRED');
});

test('Course Plan dependency cycles fail closed', () => {
  const plan = domainPlan();
  plan.learning_units.push({
    ...plan.learning_units[0], key: 'u2', title: 'Second unit', criticality: 'MEDIUM', foundational: false,
  });
  plan.dependencies = [
    { learning_unit_key: 'u1', prerequisite_learning_unit_key: 'u2' },
    { learning_unit_key: 'u2', prerequisite_learning_unit_key: 'u1' },
  ];
  const result = contracts.validateCoursePlanProposal(plan, { sources: sources() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TEACHING_D08_DEPENDENCY_CYCLE');
});

test('compressed instruction requires current independently validated prior knowledge', () => {
  const decision = { vpk_decision_id: 'v1', target_kind: 'LEARNING_UNIT', target_ref: 'u1', decision_status: 'VALIDATED_PRIOR_KNOWLEDGE', decided_at: '2026-01-02T00:00:00Z' };
  const plan = domainPlan();
  plan.learning_units[0] = { ...plan.learning_units[0], instructional_treatment: 'COMPRESSED_INSTRUCTION', vpk_basis_refs: ['v1'] };
  assert.equal(contracts.validateCoursePlanProposal(plan, { sources: sources(), vpkDecisions: [decision] }).ok, true);
  assert.equal(contracts.validateCoursePlanProposal(plan, { sources: sources(), vpkDecisions: [] }).ok, false);
});

test('frozen TPF-03 plan output may claim planned_only coverage but not authoritative coverage', () => {
  assert.equal(canonical.validateTpf03CoursePlanOutput(tpf03Output()).ok, true);
  const bad = tpf03Output();
  bad.coverage_treatment_map[0].coverage_status_claimed = 'complete';
  const result = canonical.validateTpf03CoursePlanOutput(bad);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TEACHING_D08_TPF03_COVERAGE_AUTHORITY_VIOLATION');
});

test('frozen TPF-03 unresolved or review-blocking output cannot materialize a final plan', () => {
  const output = tpf03Output({ status: 'requires_scope_review', review_required: true, review_reasons: ['scope conflict'] });
  const result = canonical.materializeCoursePlanFromTpf03(output, { audit: audit(), sources: sources() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TEACHING_D08_TPF03_PLAN_BLOCKED');
});

test('TPF-03 state reference is bound to current Course state', () => {
  const result = canonical.validateTpf03CoursePlanOutput(tpf03Output(), { course: { course_id: 'c1', state_version: 2 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TEACHING_D08_TPF03_STATE_REFERENCE_MISMATCH');
});

test('Personalization cannot lower validated curriculum competence or omit audited Learning Units', () => {
  const output = tpf03Output();
  output.course_sequence[0].learning_units[0].student_intake_accommodation_notes = 'Student says this is hard; use more examples.';
  const result = canonical.materializeCoursePlanFromTpf03(output, { audit: audit(), sources: sources() });
  assert.equal(result.ok, true);
  assert.equal(result.value.learning_units[0].intended_competence, audit().audit_output.learning_units[0].intended_competence);
  assert.equal(result.value.learning_units.length, audit().audit_output.learning_units.length);
});

test('Learning Unit lineage derives split/merge relationships from source overlap without rewriting IDs', () => {
  const a = audit().audit_output;
  a.learning_units = [
    { ...a.learning_units[0], id: 'u1a', title: 'Part A' },
    { ...a.learning_units[0], id: 'u1b', title: 'Part B' },
  ];
  a.source_accounting[0].learning_unit_ids = ['u1a','u1b'];
  const lineage = canonical.deriveLearningUnitLineage({
    previousPlanContext: { units: [{ key: 'old-u1', title: 'Old' }], sourceMappings: [{ learning_unit_key: 'old-u1', source_ref: 'source:1' }] },
    auditOutput: a,
  });
  assert.equal(lineage.length, 2);
  assert.ok(lineage.every((x) => x.kind === 'SPLIT'));
});

test('deterministic Coverage reconciliation distinguishes VPK completion from ordinary teaching', () => {
  const decision = { vpk_decision_id: 'v1', target_kind: 'LEARNING_UNIT', target_ref: 'u1', decision_status: 'VALIDATED_PRIOR_KNOWLEDGE', decided_at: '2026-01-02T00:00:00Z' };
  const result = contracts.reconcileCoverage({
    sources: sources(),
    mappings: [{ source_ref: 'source:1', learning_unit_keys: ['u1'] }, { source_ref: 'source:2', learning_unit_keys: [] }],
    vpkDecisions: [decision],
    learningUnits: [{ key: 'u1', instructional_treatment: 'VALIDATED_PRIOR_KNOWLEDGE_NO_INITIAL_INSTRUCTION', vpk_basis_refs: ['v1'] }],
  });
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.entries[0].instructional_completion_basis, 'VALIDATED_PRIOR_KNOWLEDGE');
  assert.equal(result.entries[0].validated_prior_knowledge_at instanceof Date, true);
});

test('end-of-Course Coverage accepts only TAUGHT or VALIDATED_PRIOR_KNOWLEDGE completion', () => {
  const pass = contracts.auditEndOfCourseCoverage({
    requiredSourceIds: ['s1','s2'],
    coverageRows: [
      { source_content_item_id: 's1', source_ref: 'a', instructionally_complete_at: new Date(), instructional_completion_basis: 'TAUGHT' },
      { source_content_item_id: 's2', source_ref: 'b', instructionally_complete_at: new Date(), instructional_completion_basis: 'VALIDATED_PRIOR_KNOWLEDGE' },
    ],
  });
  assert.equal(pass.completionAllowed, true);
  const fail = contracts.auditEndOfCourseCoverage({ requiredSourceIds: ['s1'], coverageRows: [{ source_content_item_id: 's1', source_ref: 'a' }] });
  assert.equal(fail.completionAllowed, false);
  assert.equal(fail.recoveryPolicyVersion, 'incomplete-required-content.v1');
});

test('student Coverage Report explicitly keeps coverage separate from mastery and hides ledger IDs', () => {
  const report = contracts.buildStudentCoverageReport({
    course: { title: 'Chemistry' },
    plan: { version_no: 1, plan_state: 'REVIEW_READY' },
    sources: [sources()[0]],
    coverageRows: [{ coverage_entry_id: 'secret-ledger-id', source_content_item_id: 's1', mapped_at: new Date(), instructionally_complete_at: null }],
    mappings: [],
  });
  assert.ok(report.messages.some((x) => /does not claim.*mastered/i.test(x)));
  assert.equal(JSON.stringify(report).includes('secret-ledger-id'), false);
});

test('activation fails closed when required coverage is unresolved', () => {
  assert.equal(contracts.activationCoverageDecision({ preActivationAudit: { outcome: 'FAIL' }, diagnosticResolved: true }).allowed, false);
  assert.equal(contracts.activationCoverageDecision({ preActivationAudit: { outcome: 'PASS' }, diagnosticResolved: false }).allowed, false);
  assert.equal(contracts.activationCoverageDecision({ preActivationAudit: { outcome: 'PASS' }, diagnosticResolved: true }).allowed, true);
});

test('scope change classification never silently applies authoritative Subject deltas', () => {
  const none = contracts.classifyScopeChange({ added: [], removed: [], changed: [] });
  assert.equal(none.changeKind, 'NO_CHANGE');
  const material = contracts.classifyScopeChange({ origin: 'SUBJECT', added: ['new'], authoritativeScope: true });
  assert.equal(material.changeKind, 'REVIEW_REQUIRED');
  assert.equal(material.requiresPlanVersion, true);
  assert.equal(material.requiresReview, true);
});

test('TPF-03 intelligence requests use exact registered capabilities and task modes', () => {
  const course = { course_id: 'c1', student_id: 'u1', state_version: 1, lifecycle_state: 'DRAFT', subject_snapshot_ref: 'snapshot:1' };
  const plan = coursePlanRequest({ course, audit: audit(), vpkDecisions: [], sources: sources(), previousPlanContext: null });
  assert.equal(plan.capabilityId, 'teaching.curriculum.course_plan_generation');
  assert.equal(plan.taskMode, 'course_plan_generation');
  assert.equal(plan.declaredAuthorityLevel, 'T3');
  assert.equal(plan.commit, false);
  assert.deepEqual(plan.contextSpec.authoritative_refs, [{ ref: 'course:c1' }]);
  assert.deepEqual(plan.contextSpec.provenance_refs, []);
  assert.deepEqual(plan.contextSpec.untrusted_refs, []);
  assert.equal(plan.academicInput.validated_planning_signals.curriculum.learning_units[0].id, 'u1');
  const scope = scopeChangeImpactRequest({ course, plan: { course_plan_id: 'p1', version_no: 1 }, candidate: { scope_change_id: 'sc1', added_source_refs: [], removed_source_refs: [], changed_source_refs: [] } });
  assert.equal(scope.capabilityId, 'teaching.curriculum.course_scope_change_impact_analysis');
  assert.equal(scope.taskMode, 'scope_change_impact_analysis');
});

test('TPF-03 uses bounded validated planning signals instead of reloading every source body', () => {
  const input = sources().map((source) => ({ ...source, content_summary: 'x'.repeat(100_000), raw_content: 'y'.repeat(100_000) }));
  const signals = boundedPlanningSignals({ audit: audit(), sources: input, vpkDecisions: [] });
  const serialized = JSON.stringify(signals);
  assert.equal(serialized.includes('raw_content'), false);
  assert.equal(serialized.includes('content_summary'), false);
  assert.ok(serialized.length < 10_000);
});

test('D08 intelligence delegates model work only through the Teaching Orchestrator', async () => {
  const calls = [];
  const intelligence = createD08Intelligence({ orchestrator: { async execute(request) { calls.push(request); return { accepted: true }; } } });
  const course = { course_id: 'c1', student_id: 'u1', state_version: 1, lifecycle_state: 'DRAFT', subject_snapshot_ref: 'snapshot:1' };
  await intelligence.generateCoursePlan({ course, audit: audit(), vpkDecisions: [], sources: sources(), previousPlanContext: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].capabilityId, 'teaching.curriculum.course_plan_generation');
});

test('D08 service reports unavailable model-backed plan generation without stale release wording', async () => {
  const service = createD08Service({
    subjects: { async getCorpusForUser() { return {}; } },
    repository: {
      async getBaseSetup() {
        return { course: { course_id: 'c1', state_version: 1, subject_snapshot_ref: 'snapshot:1' }, curriculumAudit: audit(), sources: sources(), diagnosticPlan: { requirement_state: 'NOT_REQUIRED' }, vpkDecisions: [] };
      },
    },
    intelligence: null,
  });
  await assert.rejects(service.generateCoursePlan({ id: 'u1' }, 'c1'), { code: 'TEACHING_ROUTE_UNQUALIFIED' });
});

test('D08 plan review exposes current generation readiness instead of a historical D30 gate', async () => {
  const base = {
    course: { course_id: 'c1', title: 'Course', state_version: 1, lifecycle_state: 'DRAFT', subject_snapshot_ref: 'snapshot:1' },
    curriculumAudit: audit(), sources: sources(), diagnosticPlan: { requirement_state: 'NOT_REQUIRED' }, vpkDecisions: [],
    coverageAudits: [], scopeChanges: [], learningUnits: [], topics: [], subtopics: [], coverage: [], coverageMappings: [], assumedPrerequisites: [],
  };
  const service = createD08Service({
    subjects: { async getCorpusForUser() { return {}; } },
    repository: { async getPlanReview() { return base; } },
    intelligence: { async generateCoursePlan() {} },
  });
  const review = await service.getPlanReview({ id: 'u1' }, 'c1');
  assert.equal(review.routeQualification, 'QUALIFIED_BY_RUNTIME_INJECTION');
  assert.deepEqual(review.generation, { available: true, ready: true, blockers: [] });
});

test('D08 service rejects stale Curriculum Audit after authoritative scope change', async () => {
  const stale = audit();
  stale.subject_snapshot_ref = 'old';
  const service = createD08Service({
    subjects: { async getCorpusForUser() { return {}; } },
    repository: { async getBaseSetup() { return { course: { course_id: 'c1', state_version: 2, subject_snapshot_ref: 'new' }, curriculumAudit: stale, sources: sources(), diagnosticPlan: { requirement_state: 'NOT_REQUIRED' }, vpkDecisions: [] }; } },
    intelligence: { generateCoursePlan() {} },
  });
  await assert.rejects(service.generateCoursePlan({ id: 'u1' }, 'c1'), { code: 'TEACHING_D08_CURRICULUM_AUDIT_STALE_FOR_SCOPE' });
});

test('activation readiness rejects a historical Plan after the Course source snapshot advances', async () => {
  const service = createD08Service({
    subjects: { async getCorpusForUser() { return {}; } },
    repository: { async getPlanReview() { return {
      course: { course_id: 'c1', title: 'Course', state_version: 2, subject_snapshot_ref: 'new' },
      plan: { course_plan_id: 'p1', version_no: 1, plan_state: 'REVIEW_READY', source_snapshot_ref: 'old' },
      diagnosticPlan: { requirement_state: 'NOT_REQUIRED' }, vpkDecisions: [], coverageAudits: [{ audit_kind: 'PRE_ACTIVATION', outcome: 'PASS' }], scopeChanges: [],
    }; } },
  });
  const decision = await service.getActivationCoverageDecision({ id: 'u1' }, 'c1');
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.blockingReasons, ['COURSE_PLAN_SOURCE_SNAPSHOT_STALE']);
});

test('D08 migration enforces RLS, immutable history, scoped mappings and browser read-only access', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/20260928_teaching_d08_course_plan_coverage.sql'), 'utf8');
  for (const table of [
    'teaching_course_plan_prerequisites','teaching_course_plan_source_mappings','teaching_course_plan_exclusions',
    'teaching_coverage_audits','teaching_course_scope_changes','teaching_course_scope_change_applications',
  ]) assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
  assert.match(sql, /teaching_course_plan_d08_update_guard/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE INSERT,UPDATE,DELETE,TRUNCATE[\s\S]*FROM authenticated/);
  assert.doesNotMatch(sql, /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,120}TO\s+authenticated/i);
});

test('D08 post-migration hardening fixes the guard search_path and Coverage Audit course FK index', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/20260928_teaching_d08_post_migration_hardening.sql'), 'utf8');
  assert.match(sql, /ALTER FUNCTION public\.teaching_guard_d08_course_plan_update\(\)[\s\S]*SET search_path = pg_catalog, public/);
  assert.match(sql, /CREATE INDEX teaching_coverage_audits_course_idx[\s\S]*teaching_coverage_audits\(course_id,created_at DESC\)/);
});

test('Course Plan is course-scoped with quick preview instead of global Teaching navigation', () => {
  const core = fs.readFileSync(path.resolve(__dirname, '../../../public/teaching.js'), 'utf8');
  const d08 = fs.readFileSync(path.resolve(__dirname, '../../../public/teaching-d08.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '../../../public/teaching.html'), 'utf8');
  assert.match(core, /window\.KIWITeachingCourses/);
  assert.match(core, /teachingCourseSections/);
  assert.match(d08, /courseSurface\.registerSection/);
  assert.match(d08, /id: 'course-plan'/);
  assert.match(d08, /Quick view/);
  assert.match(d08, /View full Course Plan/);
  assert.match(d08, /Create Course Plan/);
  assert.match(d08, /\/course-plan/);
  assert.doesNotMatch(d08, /Generation held until D30|No Course Plan has been committed yet/);
  assert.doesNotMatch(d08, /nav\.register|KIWITeachingNavigation/);
  assert.match(html, /teaching-course-nav__item/);
});

test('D08 feature code contains no provider/model selection, SKM writes or Gradebook writes', () => {
  const dir = path.resolve(__dirname, '../../../teaching/d08');
  const source = fs.readdirSync(dir).filter((name) => name.endsWith('.js')).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /@google\/generative-ai|openai|anthropic|gemini-pro/i);
  assert.doesNotMatch(source, /insert into\s+public\.teaching_student_knowledge/i);
  assert.doesNotMatch(source, /insert into\s+public\.(gradebook|teaching_grade)/i);
});
