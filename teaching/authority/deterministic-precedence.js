'use strict';

const DETERMINISTIC_FACT_CLASSES = Object.freeze([
  'approved_course_scope',
  'assessment_eligibility',
  'locked_assessment_state',
  'hard_schedule_constraints',
  'attendance_facts',
  'grading_policy',
  'progression_rules',
]);

function createDeterministicAuthorityCheck({
  id,
  factClass,
  readAuthoritativeState,
  conflicts,
} = {}) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new TypeError('Deterministic authority check requires an id.');
  }
  if (!DETERMINISTIC_FACT_CLASSES.includes(factClass)) {
    throw new TypeError(`Unsupported deterministic fact class: ${factClass}`);
  }
  if (typeof readAuthoritativeState !== 'function') {
    throw new TypeError('Deterministic authority check requires readAuthoritativeState().');
  }
  if (typeof conflicts !== 'function') {
    throw new TypeError('Deterministic authority check requires conflicts().');
  }

  return Object.freeze({
    id: id.trim(),
    factClass,
    async evaluate(modelOutput, context) {
      const authoritativeState = await readAuthoritativeState(context);
      const conflict = await conflicts(modelOutput, authoritativeState, context);
      return conflict
        ? Object.freeze({
            ok: false,
            reason: `DETERMINISTIC_AUTHORITY_CONFLICT:${factClass}:${id.trim()}`,
          })
        : Object.freeze({ ok: true });
    },
  });
}

module.exports = {
  DETERMINISTIC_FACT_CLASSES,
  createDeterministicAuthorityCheck,
};
