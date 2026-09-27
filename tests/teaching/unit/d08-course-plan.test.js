'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const c = require('../../../teaching/d08/contracts');
const {
  coursePlanRequest,
  scopeImpactRequest,
  coverageExplanationRequest,
  createD08Intelligence,
} = require('../../../teaching/d08/intelligence');

const audit = {
  curriculum_audit_id: 'audit-1',
  audit_output: {
    topics: [{ id: 'audit-topic', title: 'Forces', subtopics: [] }],
    learning_units: [
      { id: 'audit-u1', title: 'Force meaning' },
      { id: 'audit-u2', title: 'Force application' },
    ],
    dependencies: [],
    source_accounting: [],
    assumed_prerequisites: [{ prerequisite_ref: 'vectors', description: 'Basic vector representation' }],
    likely_misconceptions: [],
  },
};
const sources = [
  { source_content_item_id: 's1', source_ref: 'subject:physics:card:1', source_kind: 'PRIMARY_KIWI_SUBJECT', classification: 'ACADEMICALLY_MEANINGFUL', content_summary: 'Meaning of force' },
  { source_content_item_id: 's2', source_ref: 'subject:physics:card:2', source_kind: 'PRIMARY_KIWI_SUBJECT', classification: 'ACADEMICALLY_MEANINGFUL', content_summary: 'Applying F = ma' },
  { source_content_item_id: 's3', source_ref: 'subject:physics:deck:1', source_kind: 'PRIMARY_KIWI_SUBJECT', classification: 'FORMATTING_ONLY', classification_reason: 'Deck heading only', content_summary: 'Mechanics' },
];
const vpk = [
  { vpk_decision_id: 'v1', target_kind: 'PREREQUISITE', target_ref: 'vectors', decision_status: 'VALIDATED_PRIOR_KNOWLEDGE', decided_at: '2026-09-27T10:00:00Z' },
  { vpk_decision_id: 'v2', target_kind: 'LEARNING_UNIT', target_ref: 'audit-u1', decision_status: 'VALIDATED_PRIOR_KNOWLEDGE', decided_at: '2026-09-27T10:01:00Z' },
];

function validPlan() {
  return {
    topics: [{ id: 't1', title: 'Forces', ordinal: 0, subtopics: [{ id: 'st1', title: 'Foundations', ordinal: 0 }] }],
    learning_units: [
      {
        id: 'u1', title: 'Force meaning', topic_id: 't1', subtopic_id: 'st1', audit_unit_refs: ['audit-u1'],
        intended_competence: 'Explain force using an appropriate physical model.',
        exit_conditions: [{ criterion: 'Explains force correctly in an uncued example', evidence_type: 'EXPLANATION', independence_required: true }],
        criticality: 'FOUNDATIONAL', foundational: true, instructional_load_min_minutes: 10, instructional_load_max_minutes: 20,
        instructional_mode: 'VPK_COMPRESSED', planning_attention: [],
      },
      {
        id: 'u2', title: 'Force application', topic_id: 't1', subtopic_id: 'st1', audit_unit_refs: ['audit-u2'],
        intended_competence: 'Apply force relationships to solve and explain physical situations.',
        exit_conditions: [{ criterion: 'Selects and applies the correct force relationship independently', evidence_type: 'PROBLEM_SOLUTION', independence_required: true }],
        criticality: 'HIGH', foundational: false, instructional_load_min_minutes: 20, instructional_load_max_minutes: 45,
        instructional_mode: 'STANDARD', planning_attention: ['reported difficulty with vector diagrams'],
      },
    ],
    dependencies: [{ learning_unit_id: 'u2', prerequisite_learning_unit_id: 'u1', dependency_kind: 'PREREQUISITE', rationale: 'Application depends on force meaning.' }],
    source_mappings: [
      { source_ref: 'subject:physics:card:1', learning_unit_ids: ['u1'] },
      { source_ref: 'subject:physics:card:2', learning_unit_ids: ['u2'] },
    ],
    assumed_prerequisites: [{ prerequisite_ref: 'vectors', disclosure: 'Basic vector representation is assumed and has been independently validated.' }],
    excluded_sources: [{ source_ref: 'subject:physics:deck:1', reason: 'Formatting-only deck heading; academic cards remain mapped.' }],
    planning_summary: 'Plan covers the audited force curriculum while preserving verified prior knowledge and additional attention for vector diagrams.',
  };
}

test('D08 validates a complete Course Plan against Audit units, required sources, prerequisites and meaningful exit conditions', () => {
  const result = c.validateCoursePlanProposal(validPlan(), { audit, sourceItems: sources, vpkDecisions: vpk });
  assert.equal(result.ok, true);
  assert.equal(result.value.learning_units[0].instructional_mode, 'VPK_COMPRESSED');
  assert.equal(result.value.learning_units[0].later_assessment_basis, 'VALIDATED_PRIOR_KNOWLEDGE');
  assert.match(result.scopeChecksum, /^[a-f0-9]{64}$/);
});

test('D08 blocks one silently omitted required source and activation coverage fails closed', () => {
  const proposal = validPlan();
  proposal.source_mappings = proposal.source_mappings.slice(0, 1);
  const validation = c.validateCoursePlanProposal(proposal, { audit, sourceItems: sources, vpkDecisions: vpk });
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'TEACHING_D08_REQUIRED_SOURCE_UNMAPPED');
  const reconciliation = c.reconcileCoverage({
    sourceItems: sources,
    mappings: [{ source_content_item_id: 's1', learning_unit_id: 'lu1' }],
    exclusions: [{ source_content_item_id: 's3', approved: true, reason: 'Formatting only', approval_authority_ref: 'source-meaningfulness.v1' }],
    coverageRows: [],
    learningUnits: [],
    stage: 'PRE_ACTIVATION',
  });
  assert.equal(reconciliation.status, 'BLOCKED');
  assert.equal(reconciliation.unresolved.length, 1);
  assert.equal(c.activationDecision({ reconciliation, learningUnits: [] }).allowed, false);
});

test('D08 Personalization Invariant allows planning attention but rejects model authority smuggling', () => {
  const accepted = c.validateCoursePlanProposal(validPlan(), { audit, sourceItems: sources, vpkDecisions: vpk });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.value.learning_units[1].planning_attention, ['reported difficulty with vector diagrams']);
  const bad = validPlan();
  bad.learning_units[1].mastery = 'WEAK';
  const rejected = c.validateCoursePlanProposal(bad, { audit, sourceItems: sources, vpkDecisions: vpk });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'TEACHING_D08_AUTHORITY_SMUGGLING');
});

test('self-reported prior knowledge cannot authorize VPK compression or assessment eligibility', () => {
  const proposal = validPlan();
  const withoutEvidence = c.validateCoursePlanProposal(proposal, { audit, sourceItems: sources, vpkDecisions: [] });
  assert.equal(withoutEvidence.ok, false);
  assert.equal(withoutEvidence.reason, 'TEACHING_D08_VPK_COMPRESSION_UNAUTHORIZED');
  assert.equal(Object.hasOwn(proposal.learning_units[0], 'assessment_eligible'), false);
});

test('VPK compression retains a validated-prior-knowledge basis without inventing ordinary teaching', () => {
  const result = c.validateCoursePlanProposal(validPlan(), { audit, sourceItems: sources, vpkDecisions: vpk });
  assert.equal(result.value.learning_units[0].instructional_mode, 'VPK_COMPRESSED');
  assert.equal(result.value.learning_units[0].later_assessment_basis, 'VALIDATED_PRIOR_KNOWLEDGE');
  const end = c.reconcileCoverage({
    sourceItems: sources,
    mappings: [
      { source_content_item_id: 's1', learning_unit_id: 'lu1' },
      { source_content_item_id: 's2', learning_unit_id: 'lu2' },
    ],
    exclusions: [{ source_content_item_id: 's3', approved: true, reason: 'Formatting only', approval_authority_ref: 'source-meaningfulness.v1' }],
    coverageRows: [
      { source_content_item_id: 's1', instructionally_complete_at: 'now', instructional_completion_basis: 'VALIDATED_PRIOR_KNOWLEDGE' },
      { source_content_item_id: 's2', instructionally_complete_at: 'now', instructional_completion_basis: 'TAUGHT' },
    ],
    learningUnits: [{ learning_unit_id: 'lu1', title: 'Force meaning' }, { learning_unit_id: 'lu2', title: 'Force application' }],
    stage: 'END_OF_COURSE',
  });
  assert.equal(end.status, 'PASS');
  assert.deepEqual(new Set(end.accounted.map((x) => x.basis)), new Set(['VALIDATED_PRIOR_KNOWLEDGE', 'TAUGHT']));
  assert.equal(Object.hasOwn(end, 'mastery'), false);
});

test('end-of-Course coverage routes incomplete required curriculum to recovery rather than failure', () => {
  const end = c.reconcileCoverage({
    sourceItems: sources,
    mappings: [
      { source_content_item_id: 's1', learning_unit_id: 'lu1' },
      { source_content_item_id: 's2', learning_unit_id: 'lu2' },
    ],
    exclusions: [{ source_content_item_id: 's3', approved: true, reason: 'Formatting only', approval_authority_ref: 'source-meaningfulness.v1' }],
    coverageRows: [{ source_content_item_id: 's1', instructionally_complete_at: 'now', instructional_completion_basis: 'TAUGHT' }],
    learningUnits: [{ learning_unit_id: 'lu1', title: 'Force meaning' }, { learning_unit_id: 'lu2', title: 'Force application' }],
    stage: 'END_OF_COURSE',
  });
  assert.equal(end.status, 'INCOMPLETE');
  assert.deepEqual(c.completionDecision({ reconciliation: end }), {
    allowed: false,
    decision: 'INCOMPLETE_RECOVERY_REQUIRED',
    incomplete_is_fail: false,
    policy_version: 'incomplete-required-content.v1',
  });
});

test('active authoritative Subject changes require formal Course Plan review rather than silent inheritance', () => {
  const current = [{ source_ref: 'r1', source_kind: 'PRIMARY_KIWI_SUBJECT', content_hash: 'a', classification: 'ACADEMICALLY_MEANINGFUL' }];
  const candidate = [
    { source_ref: 'r1', source_kind: 'PRIMARY_KIWI_SUBJECT', content_hash: 'a', classification: 'ACADEMICALLY_MEANINGFUL' },
    { source_ref: 'r2', source_kind: 'PRIMARY_KIWI_SUBJECT', content_hash: 'b', classification: null },
  ];
  const change = c.classifyScopeChange({ currentSources: current, candidateSources: candidate, courseLifecycle: 'ACTIVE' });
  assert.equal(change.classification, 'FORMAL_COURSE_PLAN_UPDATE');
  assert.equal(change.requiresPlanVersion, true);
  assert.equal(current.length, 1, 'current Course snapshot remains unchanged until explicit review/application');
});

test('Course Plan version diff is explicit and never rewrites prior units', () => {
  const diff = c.buildPlanDiff({ learningUnits: [{ title: 'A' }], prerequisites: [{ prerequisite_ref: 'p1' }] }, {
    learning_units: [{ title: 'A' }, { title: 'B' }],
    assumed_prerequisites: [{ prerequisite_ref: 'p2' }],
  });
  assert.deepEqual(diff.added_learning_units, ['B']);
  assert.deepEqual(new Set(diff.prerequisite_changes), new Set(['p1', 'p2']));
  assert.match(diff.student_summary, /updated/i);
});

test('later controlled contradiction creates a superseding VPK downgrade without rewriting history', () => {
  const current = { vpk_decision_id: 'old-vpk', target_kind: 'LEARNING_UNIT', target_ref: 'audit-u1', decision_status: 'VALIDATED_PRIOR_KNOWLEDGE' };
  const result = c.evaluateVpkContradiction({
    currentDecision: current,
    validatorId: 'evidence-owner',
    validatorVersion: '2',
    evidence: [{ evidenceRef: 'e1', probeRef: 'p1', controlled: true, independent: true, contradicts: true }],
  });
  assert.equal(result.changed, true);
  assert.equal(result.status, 'NOT_VALIDATED');
  assert.equal(result.supersedesVpkDecisionId, 'old-vpk');
  assert.equal(current.decision_status, 'VALIDATED_PRIOR_KNOWLEDGE');
});

test('Course Coverage report is student-facing and contains no raw ledger IDs', () => {
  const reconciliation = c.reconcileCoverage({ sourceItems: sources, mappings: [], exclusions: [], coverageRows: [], learningUnits: [], stage: 'PRE_ACTIVATION' });
  const report = c.buildCoverageReport({ sourceItems: sources, reconciliation, scopeChanges: [], prerequisites: [] });
  const serialized = JSON.stringify(report);
  assert.match(report.headline, /coverage/i);
  assert.doesNotMatch(serialized, /coverage_entry_id|course_plan_id|source_content_item_id/i);
});

test('seven discipline fixtures exist and describe pedagogical profiles rather than subject personalities', () => {
  const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/d08/curriculum-profiles.json'), 'utf8'));
  assert.deepEqual(fixtures.map((x) => x.discipline), ['mathematics', 'biology', 'chemistry', 'history', 'literature', 'computer science', 'mixed-profile']);
  assert.ok(fixtures.every((x) => Array.isArray(x.example_units) && x.example_units.length >= 3));
  assert.ok(fixtures.every((x) => !/personality|teacher persona/i.test(JSON.stringify(x))));
});

test('same audited subject can support different valid Learning Unit profiles without subject-personality stereotyping', () => {
  const planA = validPlan();
  const planB = validPlan();
  planB.learning_units = [
    { ...planB.learning_units[0], id: 'u1a', title: 'Force concept', audit_unit_refs: ['audit-u1'], instructional_mode: 'VPK_COMPRESSED' },
    { ...planB.learning_units[1], id: 'u2a', title: 'Force equation selection', audit_unit_refs: ['audit-u2'], instructional_load_min_minutes: 10, instructional_load_max_minutes: 25 },
    { ...planB.learning_units[1], id: 'u2b', title: 'Force equation explanation', audit_unit_refs: ['audit-u2'], instructional_load_min_minutes: 10, instructional_load_max_minutes: 25 },
  ];
  planB.dependencies = [
    { learning_unit_id: 'u2a', prerequisite_learning_unit_id: 'u1a', dependency_kind: 'PREREQUISITE', rationale: 'Concept first.' },
    { learning_unit_id: 'u2b', prerequisite_learning_unit_id: 'u2a', dependency_kind: 'PREREQUISITE', rationale: 'Select before explaining.' },
  ];
  planB.source_mappings = [
    { source_ref: 'subject:physics:card:1', learning_unit_ids: ['u1a'] },
    { source_ref: 'subject:physics:card:2', learning_unit_ids: ['u2a', 'u2b'] },
  ];
  assert.equal(c.validateCoursePlanProposal(planA, { audit, sourceItems: sources, vpkDecisions: vpk }).ok, true);
  assert.equal(c.validateCoursePlanProposal(planB, { audit, sourceItems: sources, vpkDecisions: vpk }).ok, true);
  assert.notEqual(planA.learning_units.length, planB.learning_units.length);
});

test('D08 intelligence binds TPF-03 work and TPF-19 explanation through registered capabilities only', async () => {
  const course = { course_id: 'c1', student_id: 'u1', lifecycle_state: 'DRAFT', state_version: 1 };
  const planRequest = coursePlanRequest({ course, audit, sources, vpkDecisions: vpk });
  assert.equal(planRequest.capabilityId, 'teaching.curriculum.course_plan_generation');
  assert.equal(planRequest.resultContract.authority_ceiling, 'T3');
  const scope = scopeImpactRequest({ course, scopeChange: { scope_change_id: 'sc1', change_classification: 'FORMAL_COURSE_PLAN_UPDATE', requires_plan_version: true }, currentPlan: null });
  assert.equal(scope.capabilityId, 'teaching.curriculum.course_scope_change_impact_analysis');
  const explanation = coverageExplanationRequest({ course, coverageAudit: { coverage_audit_id: 'ca1', status: 'BLOCKED', machine_result: {} } });
  assert.equal(explanation.capabilityId, 'teaching.crosscutting.course_coverage_explanation');
  assert.equal(explanation.resultContract.authority_ceiling, 'T1');
  const calls = [];
  const intelligence = createD08Intelligence({ orchestrator: { async execute(request) { calls.push(request); return { accepted: true }; } } });
  await intelligence.generateCoursePlan({ course, audit, sources, vpkDecisions: vpk });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].capabilityId, 'teaching.curriculum.course_plan_generation');
});

test('D08 migration preserves owner-scoped read-only browser access and versioned lineage', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/20260927_teaching_d08_course_plan_coverage.sql'), 'utf8');
  for (const table of ['teaching_course_plan_prerequisites', 'teaching_course_plan_source_mappings', 'teaching_course_plan_exclusions', 'teaching_coverage_audits', 'teaching_course_scope_changes', 'teaching_course_scope_change_applications']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /teaching_course_plan_version_guard/);
  assert.match(sql, /teaching_learning_unit_lineage/);
  assert.doesNotMatch(sql, /GRANT\s+(INSERT|UPDATE|DELETE)[\s\S]{0,160}authenticated/i);
});

test('D08 feature code contains no provider/model selection and no SKM/Gradebook mutation', () => {
  const dir = path.resolve(__dirname, '../../../teaching/d08');
  const source = fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /@google\/generative-ai|gemini|openai|anthropic|model[-_ ]?id/i);
  assert.doesNotMatch(source, /insert into\s+public\.(teaching_student_knowledge|gradebook|grades)/i);
});

test('D08 student review module has valid JavaScript syntax', () => {
  execFileSync(process.execPath, ['--check', path.resolve(__dirname, '../../../public/teaching-d08.js')], { stdio: 'pipe' });
});
