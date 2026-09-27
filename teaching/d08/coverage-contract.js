'use strict';

const { COVERAGE_RULE_VERSION, COMPLETION_BASES, failure, validateExitConditions } = require('./contracts-core');

function reconcileCoverage({ sourceItems = [], mappings = [], exclusions = [], coverageRows = [], learningUnits = [], stage = 'PRE_ACTIVATION', blockingConditions = [] } = {}) {
  if (!['PRE_ACTIVATION', 'END_OF_COURSE'].includes(stage)) failure('Unsupported Coverage Audit stage.');
  const mappedBySource = new Map();
  for (const mapping of mappings) {
    const sourceId = String(mapping.source_content_item_id || '');
    if (!sourceId || !mapping.learning_unit_id) continue;
    const set = mappedBySource.get(sourceId) || new Set();
    set.add(String(mapping.learning_unit_id));
    mappedBySource.set(sourceId, set);
  }
  const approvedExclusions = new Map(exclusions.filter((item) => item.approved === true && String(item.reason || '').trim() && String(item.approval_authority_ref || '').trim()).map((item) => [String(item.source_content_item_id), item]));
  const latestCoverage = new Map();
  for (const row of coverageRows) latestCoverage.set(String(row.source_content_item_id), row);
  const unitNames = new Map(learningUnits.map((unit) => [String(unit.learning_unit_id), unit.title]));
  const required = sourceItems.filter((source) => source.academically_meaningful === true || source.classification === 'ACADEMICALLY_MEANINGFUL');
  const unresolved = Array.isArray(blockingConditions) ? blockingConditions.map((item) => ({ label: String(item?.label || 'Course scope review'), reason: String(item?.reason || 'BLOCKING_CONDITION') })) : [];
  const accounted = [];
  const incomplete = [];
  for (const source of required) {
    const sourceId = String(source.source_content_item_id);
    const mapped = mappedBySource.get(sourceId);
    if (!mapped?.size) {
      if (approvedExclusions.has(sourceId)) {
        accounted.push({ label: source.content_summary || source.source_ref, basis: 'APPROVED_EXCLUSION' });
      } else {
        unresolved.push({ label: source.content_summary || source.source_ref, reason: 'REQUIRED_SOURCE_UNMAPPED' });
      }
      continue;
    }
    if (stage === 'PRE_ACTIVATION') {
      accounted.push({ label: source.content_summary || source.source_ref, basis: 'MAPPED' });
      continue;
    }
    const coverage = latestCoverage.get(sourceId);
    if (coverage?.instructionally_complete_at && COMPLETION_BASES.has(String(coverage.instructional_completion_basis))) {
      accounted.push({ label: source.content_summary || source.source_ref, basis: String(coverage.instructional_completion_basis) });
    } else {
      incomplete.push({ label: source.content_summary || source.source_ref, mappedUnits: [...mapped].map((id) => unitNames.get(id) || 'Required Learning Unit') });
    }
  }
  const status = unresolved.length ? 'BLOCKED' : stage === 'END_OF_COURSE' && incomplete.length ? 'INCOMPLETE' : 'PASS';
  return Object.freeze({
    stage,
    status,
    pass: status === 'PASS',
    unresolved: Object.freeze(unresolved.map(Object.freeze)),
    accounted: Object.freeze(accounted.map(Object.freeze)),
    incomplete: Object.freeze(incomplete.map(Object.freeze)),
    totals: Object.freeze({ required: required.length, accounted: accounted.length, unresolved: unresolved.length, incomplete: incomplete.length }),
    rule_version: COVERAGE_RULE_VERSION,
    policy_version: COVERAGE_RULE_VERSION,
    mastery_state: undefined,
  });
}

function activationDecision({ reconciliation, learningUnits = [] } = {}) {
  if (!reconciliation || reconciliation.stage !== 'PRE_ACTIVATION') failure('Pre-activation Coverage reconciliation is required.');
  const invalidCritical = learningUnits.filter((unit) => {
    if (!(unit.foundational === true || ['HIGH', 'FOUNDATIONAL'].includes(String(unit.criticality)))) return false;
    const result = validateExitConditions({ ...unit, id: unit.learning_unit_id || unit.id });
    return !result.ok;
  });
  const allowed = reconciliation.status === 'PASS' && invalidCritical.length === 0;
  return Object.freeze({ allowed, decision: allowed ? 'COVERAGE_READY_FOR_D10_ACTIVATION' : 'ACTIVATION_BLOCKED', blocker_codes: Object.freeze([...(reconciliation.unresolved.length ? ['REQUIRED_SOURCE_UNMAPPED'] : []), ...(invalidCritical.length ? ['CRITICAL_EXIT_CONDITION_INVALID'] : [])]), authoritative_owner: 'Course lifecycle/Progression' });
}
function completionDecision({ reconciliation } = {}) {
  if (!reconciliation || reconciliation.stage !== 'END_OF_COURSE') failure('End-of-Course Coverage reconciliation is required.');
  if (reconciliation.status === 'PASS') return Object.freeze({ allowed: true, decision: 'COVERAGE_COMPLETE', incomplete_is_fail: false, policy_version: 'incomplete-required-content.v1' });
  return Object.freeze({ allowed: false, decision: 'INCOMPLETE_RECOVERY_REQUIRED', incomplete_is_fail: false, policy_version: 'incomplete-required-content.v1' });
}

function buildCoverageReport({ sourceItems = [], reconciliation, scopeChanges = [], prerequisites = [] } = {}) {
  if (!reconciliation) failure('Coverage reconciliation is required.');
  const supplemental = sourceItems.filter((source) => source.source_kind === 'STUDENT_SUPPLEMENT' || source.source_kind === 'AUTHORITATIVE_SCHOOL_SCOPE').length;
  const latestChange = [...scopeChanges].sort((a, b) => String(b.detected_at || '').localeCompare(String(a.detected_at || '')))[0] || null;
  const gaps = [...reconciliation.unresolved, ...reconciliation.incomplete].map((item) => item.label);
  return Object.freeze({
    headline: reconciliation.status === 'PASS' ? 'Course coverage is accounted for.' : 'Course coverage needs review.',
    status: reconciliation.status,
    summary: reconciliation.status === 'PASS'
      ? `KIWI has accounted for all ${reconciliation.totals.required} required course source item${reconciliation.totals.required === 1 ? '' : 's'}.`
      : `${gaps.length} required course item${gaps.length === 1 ? ' needs' : 's need'} attention before the next protected course transition.`,
    whatKiwiFound: Object.freeze({ requiredMeaningfulItems: reconciliation.totals.required, supplementarySources: supplemental, assumedPrerequisites: prerequisites.length }),
    gaps: Object.freeze(gaps),
    latestScopeUpdate: latestChange ? latestChange.student_summary || 'A Course scope update is under review.' : null,
    completionMeaning: reconciliation.stage === 'END_OF_COURSE' ? 'Coverage completion means required curriculum was taught or independently validated as prior knowledge; it is not the same thing as mastery.' : 'Pre-activation coverage means required curriculum is represented in the reviewed plan; it is not the same thing as mastery.',
  });
}

module.exports = { reconcileCoverage, activationDecision, completionDecision, buildCoverageReport };
