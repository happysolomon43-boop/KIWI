'use strict';

const PRIVILEGED_TEACHING_OPERATIONS = Object.freeze([
  'grading.finalize',
  'assessment.package.lock',
  'request.formal.decide',
  'schedule.authority.update',
]);

function isPrivilegedTeachingOperation(operation) {
  return PRIVILEGED_TEACHING_OPERATIONS.includes(String(operation));
}

function assertServerPrivilegeBoundary(operation, context = {}) {
  if (!isPrivilegedTeachingOperation(operation)) {
    throw new TypeError(`Unknown privileged Teaching operation: ${operation}`);
  }

  if (context.trustBoundary !== 'server') {
    const error = new Error(`Teaching operation ${operation} is server-authoritative and cannot trust the browser.`);
    error.code = 'TEACHING_SERVER_AUTHORITY_REQUIRED';
    throw error;
  }

  return true;
}

module.exports = {
  PRIVILEGED_TEACHING_OPERATIONS,
  isPrivilegedTeachingOperation,
  assertServerPrivilegeBoundary,
};
