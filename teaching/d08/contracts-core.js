'use strict';

const crypto = require('node:crypto');

const PLAN_SCHEMA_VERSION = 'd08.course-plan.v1';
const COVERAGE_RULE_VERSION = 'coverage-reconciliation.v1';
const SCOPE_CHANGE_RULE_VERSION = 'course-scope-change.v1';
const EXIT_CONDITION_RULE_VERSION = 'learning-unit-exit-condition.v1';
const VPK_CONTRADICTION_RULE_VERSION = 'vpk-contradiction.v1';
const CRITICALITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'FOUNDATIONAL']);
const COMPLETION_BASES = new Set(['TAUGHT', 'VALIDATED_PRIOR_KNOWLEDGE']);
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'mastery', 'mastery_state', 'secure', 'mark', 'marks', 'grade', 'score', 'gpa',
  'assessment_eligible', 'assessmentEligibility', 'pass_threshold', 'passThreshold',
  'progression_state', 'progressionOutcome', 'lifecycle_state', 'course_state',
]);
const EVIDENCE_TYPES = new Set([
  'EXPLANATION', 'PROBLEM_SOLUTION', 'DERIVATION', 'DEMONSTRATION', 'APPLICATION',
  'IDENTIFICATION', 'COMPARISON', 'ANALYSIS', 'CONSTRUCTION', 'PROOF', 'EVALUATION',
  'IMPLEMENTATION', 'TRACE', 'MODEL', 'WRITTEN_RESPONSE', 'ORAL_RESPONSE', 'OTHER',
]);

function digest(value) {
  const stable = (item) => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])]));
    return item;
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function failure(message, code = 'TEACHING_D08_CONTRACT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function text(value, field, max = 4000, required = true) {
  if (value == null && !required) return null;
  const out = String(value ?? '').trim();
  if (required && !out) failure(`${field} is required.`);
  if (Buffer.byteLength(out) > max) failure(`${field} exceeds ${max} bytes.`);
  return out || null;
}
function array(value, field, max = 1000) {
  if (!Array.isArray(value) || value.length > max) failure(`${field} must be an array with at most ${max} items.`);
  return value;
}
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) failure(`${field} must be an object.`);
  return value;
}
function assertNoAuthoritySmuggling(value, path = 'plan') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoAuthoritySmuggling(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) failure(`${path}.${key} attempts to claim authority outside Course Planning.`, 'TEACHING_D08_AUTHORITY_SMUGGLING');
    assertNoAuthoritySmuggling(child, `${path}.${key}`);
  }
}
function latestVpk(vpkDecisions = []) {
  const ordered = [...vpkDecisions].sort((a, b) => String(a.decided_at || '').localeCompare(String(b.decided_at || '')));
  const map = new Map();
  for (const row of ordered) map.set(`${row.target_kind}:${row.target_ref}`, row);
  return map;
}
function normalizeExitCondition(raw, field) {
  if (typeof raw === 'string') {
    const criterion = text(raw, field, 2000);
    return Object.freeze({ criterion, evidence_type: 'OTHER', independence_required: false, source_form: 'CURRICULUM_AUDIT_TEXT' });
  }
  const condition = object(raw, field);
  const criterion = text(condition.criterion, `${field}.criterion`, 2000);
  const evidenceType = text(condition.evidence_type || 'OTHER', `${field}.evidence_type`, 100).toUpperCase();
  if (!EVIDENCE_TYPES.has(evidenceType)) failure(`${field}.evidence_type is not an approved evidence description.`, 'TEACHING_D08_EXIT_CONDITION_INVALID');
  return Object.freeze({
    criterion,
    evidence_type: evidenceType,
    independence_required: condition.independence_required === true,
    source_form: 'STRUCTURED',
  });
}
function validateExitConditions(unit) {
  try {
    const critical = unit.foundational === true || ['HIGH', 'FOUNDATIONAL'].includes(String(unit.criticality || '').toUpperCase());
    const conditions = array(unit.exit_conditions, `learning_unit:${unit.id || unit.learning_unit_id}.exit_conditions`, 50)
      .map((condition, index) => normalizeExitCondition(condition, `exit_conditions[${index}]`));
    if (critical && !conditions.length) failure('Critical Learning Units require evidence-bearing exit conditions.', 'TEACHING_D08_CRITICAL_EXIT_CONDITION_REQUIRED');
    const evidenceVerb = /\b(solve|explain|derive|demonstrate|apply|identify|compare|analyse|analyze|produce|calculate|justify|complete|distinguish|interpret|construct|prove|evaluate|show|write|classify|predict|design|implement|trace|model)\b/i;
    if (critical && !conditions.some((condition) => condition.criterion.length >= 8 && (condition.evidence_type !== 'OTHER' || evidenceVerb.test(condition.criterion)))) {
      failure('Critical Learning Unit exit conditions are not meaningful enough to support later evidence.', 'TEACHING_D08_CRITICAL_EXIT_CONDITION_NOT_MEANINGFUL');
    }
    return { ok: true, value: conditions, critical, ruleVersion: EXIT_CONDITION_RULE_VERSION };
  } catch (error) {
    return { ok: false, reason: error.code || error.message };
  }
}

module.exports = { PLAN_SCHEMA_VERSION, COVERAGE_RULE_VERSION, SCOPE_CHANGE_RULE_VERSION, EXIT_CONDITION_RULE_VERSION, VPK_CONTRADICTION_RULE_VERSION, CRITICALITIES, COMPLETION_BASES, digest, failure, text, array, object, assertNoAuthoritySmuggling, latestVpk, validateExitConditions };
