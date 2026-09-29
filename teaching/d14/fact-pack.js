'use strict';

// TPF-19 receives only typed, student-safe facts. This module deliberately has
// no database writer and cannot become an academic owner.
const VISIBLE = new Set(['STUDENT', 'REQUIRED', 'ALLOWED']);
const STATUSES = Object.freeze({
  AUTHORITATIVE: 'AUTHORITATIVE_FINAL', AUTHORITATIVE_FINAL: 'AUTHORITATIVE_FINAL',
  AUTHORITATIVE_PROVISIONAL: 'AUTHORITATIVE_PROVISIONAL', INFERRED: 'INFERRED',
  PLANNED: 'PLANNED', UNRESOLVED: 'UNRESOLVED',
});
const CLASSES = Object.freeze({
  CONTROLLER_FACT: 'AUTHORITATIVE_OPERATIONAL_STATE', OFFICIAL_RECORD: 'OFFICIAL_RECORD',
  AUTHORITATIVE_OPERATIONAL_STATE: 'AUTHORITATIVE_OPERATIONAL_STATE',
  LEARNING_INFERENCE: 'LEARNING_INFERENCE', PLANNING_PROJECTION: 'PLANNING_PROJECTION',
  POLICY_FACT: 'POLICY_FACT', SYSTEM_FAILURE_FACT: 'SYSTEM_FAILURE_FACT', UNRESOLVED: 'UNRESOLVED',
});
const PROTECTED = /(?:answer[_ -]?key|hidden[_ -]?prompt|chain[_ -]?of[_ -]?thought|rubric[_ -]?key|integrity[_ -]?signal|raw[_ -]?probabilit|assessment[_ -]?blueprint|protected[_ -]?content|secret|token)/i;

function fail(code) { const e = new Error(code); e.code = code; e.status = 422; throw e; }
function safeText(value) {
  if (typeof value !== 'string' || value.length > 3000 || PROTECTED.test(value)) fail('TEACHING_D14_PROTECTED_FACT');
  return value.trim();
}
function safeValue(value, depth = 0) {
  if (depth > 3) fail('TEACHING_D14_FACT_DEPTH');
  if (value == null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return safeText(value);
  if (Array.isArray(value) && value.length <= 100) return value.map((x) => safeValue(x, depth + 1));
  fail('TEACHING_D14_FACT_VALUE_INVALID');
}
function assembleStudentFactPack({ snapshotRef, currentSnapshotRef = snapshotRef, facts = [], translationMode = 'CLASS_SUMMARY' } = {}) {
  if (!snapshotRef || snapshotRef !== currentSnapshotRef) fail('TEACHING_D14_STALE_FACT_PACK');
  if (!Array.isArray(facts) || facts.length > 100) fail('TEACHING_D14_FACTS_INVALID');
  const seen = new Map();
  const normalized = [];
  for (const [index, source] of facts.entries()) {
    if (!source || typeof source !== 'object') fail('TEACHING_D14_FACT_INVALID');
    const key = safeText(source.semantic_key);
    const domain = safeText(source.truth_domain);
    const status = STATUSES[source.truth_status];
    const kind = CLASSES[source.fact_class];
    if (!key || !domain || PROTECTED.test(key) || !status || !kind || !source.source_owner) fail('TEACHING_D14_FACT_CONTRACT_INVALID');
    if (!VISIBLE.has(source.visibility || source.student_visibility)) continue;
    const state = safeValue(source.effective_state ?? source.statement);
    const scope = `${domain}:${key}:${source.effective_at || ''}`;
    const digest = JSON.stringify(state);
    if (seen.has(scope) && seen.get(scope) !== digest && !source.supersedes_fact_id) fail('TEACHING_D14_UNRESOLVED_FACT_CONFLICT');
    seen.set(scope, digest);
    const refs = source.provenance_refs || [];
    if (!Array.isArray(refs) || !refs.length || refs.some((ref) => typeof ref !== 'string' || PROTECTED.test(ref))) fail('TEACHING_D14_PROVENANCE_REQUIRED');
    normalized.push(Object.freeze({
      fact_id: `${snapshotRef}:fact:${index}`, source_owner: safeText(source.source_owner), truth_domain: domain,
      semantic_key: key, fact_class: kind, truth_status: status,
      student_visibility: source.visibility === 'STUDENT' ? 'ALLOWED' : source.student_visibility || source.visibility,
      statement: typeof state === 'string' ? state : JSON.stringify(state), effective_state: state,
      reason_or_basis: source.reason_or_basis ? safeText(source.reason_or_basis) : null,
      consequence: source.consequence ? safeText(source.consequence) : null,
      uncertainty: source.uncertainty ? safeText(source.uncertainty) : null,
      provisional: source.provisional === true || status === 'AUTHORITATIVE_PROVISIONAL' || status === 'PLANNED',
      effective_at: source.effective_at || null, supersedes_fact_id: source.supersedes_fact_id || null,
      provenance_refs: Object.freeze(refs.slice()),
    }));
  }
  const factPack = Object.freeze({ snapshot_ref: snapshotRef, facts: Object.freeze(normalized) });
  const directive = Object.freeze({
    translation_mode: translationMode, audience: 'student', presentation_voice: 'TEACHER_IDENTITY',
    purpose: 'Communicate authoritative Class closure without creating academic state.',
    source_snapshot_ref: snapshotRef, current_source_snapshot_ref: currentSnapshotRef,
    required_fact_ids: Object.freeze(normalized.map((f) => f.fact_id)), optional_fact_ids: Object.freeze([]),
    disclosure_ceiling: 'STANDARD', assessment_disclosure: 'NONE', student_action_required: null,
    sensitive_context: 'ROUTINE', response_budget: 'STANDARD',
    conflict_policy: 'HANDOFF_ON_UNRESOLVED_AUTHORITATIVE_CONFLICT',
  });
  return Object.freeze({ directive, factPack, translationOnly: true, authoritativeMutation: false });
}
function classClosureTranslation(closure) {
  const source = closure?.fact_pack?.student_translation_fact_pack;
  if (!closure?.closure_fact_id || !Array.isArray(source?.facts)) fail('TEACHING_D14_CLOSURE_FACTS_REQUIRED');
  return assembleStudentFactPack({ snapshotRef: `class-closure:${closure.closure_fact_id}@${closure.controller_version}`, facts: source.facts });
}
module.exports = { assembleStudentFactPack, classClosureTranslation };
