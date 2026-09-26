'use strict';

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function compareStateSnapshot(expected, current) {
  const reasons = [];
  if (!expected || !current) {
    return Object.freeze({ stale: true, reasons: Object.freeze(['STATE_SNAPSHOT_MISSING']) });
  }
  for (const field of ['aggregate_type', 'aggregate_id', 'state_version']) {
    if (String(expected[field] ?? '') !== String(current[field] ?? '')) {
      reasons.push(`STATE_${field.toUpperCase()}_CHANGED`);
    }
  }
  if (expected.precondition_token != null && String(expected.precondition_token) !== String(current.precondition_token ?? '')) {
    reasons.push('STATE_PRECONDITION_TOKEN_CHANGED');
  }
  return Object.freeze({ stale: reasons.length > 0, reasons: Object.freeze(reasons) });
}

function comparePreconditions(expected = {}, current = {}) {
  if (stable(expected) === stable(current)) return Object.freeze({ stale: false, reasons: Object.freeze([]) });
  return Object.freeze({ stale: true, reasons: Object.freeze(['AUTHORITATIVE_PRECONDITIONS_CHANGED']) });
}

function revalidateAuthoritativeState({ expectedState, currentState, expectedPreconditions = {}, currentPreconditions = {} } = {}) {
  const state = compareStateSnapshot(expectedState, currentState);
  const preconditions = comparePreconditions(expectedPreconditions, currentPreconditions);
  return Object.freeze({ stale: state.stale || preconditions.stale, reasons: Object.freeze([...state.reasons, ...preconditions.reasons]) });
}

function assertFreshAuthoritativeState(input) {
  const result = revalidateAuthoritativeState(input);
  if (result.stale) {
    const error = new Error(`Teaching intelligence result is stale: ${result.reasons.join(', ')}`);
    error.code = 'TEACHING_D05_STALE_RESULT_REJECTED';
    error.reasons = result.reasons;
    throw error;
  }
  return true;
}

module.exports = { compareStateSnapshot, comparePreconditions, revalidateAuthoritativeState, assertFreshAuthoritativeState };
