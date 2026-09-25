'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BROWSER_READ_ONLY_TABLES,
  SERVER_AUTHORITATIVE_MUTATIONS,
  FUTURE_PRIVILEGED_ACADEMIC_OPERATIONS,
  PRIVATE_PREPARATION_SCHEMA,
  PROTECTED_PREPARATION_SCHEMA,
  assertServerAcademicMutation,
  assertProtectedPreparationAccess,
} = require('../../../teaching/security/d04-persistence-contract');
const { createTeachingKernelPersistence } = require('../../../teaching/repositories/kernel-persistence');

test('D04 browser surface is read-only and protected preparation is separate', () => {
  assert.ok(BROWSER_READ_ONLY_TABLES.includes('teaching_assessment_eligibility'));
  assert.ok(BROWSER_READ_ONLY_TABLES.includes('teaching_academic_audit_log'));
  assert.equal(PRIVATE_PREPARATION_SCHEMA, 'teaching_preparation');
  assert.equal(PROTECTED_PREPARATION_SCHEMA, 'teaching_protected');
});

test('D04 academic mutations require the server trust boundary', () => {
  for (const operation of [...SERVER_AUTHORITATIVE_MUTATIONS, ...FUTURE_PRIVILEGED_ACADEMIC_OPERATIONS]) {
    assert.equal(assertServerAcademicMutation(operation, { trustBoundary: 'server' }), true);
    assert.throws(
      () => assertServerAcademicMutation(operation, { trustBoundary: 'browser' }),
      (error) => error.code === 'TEACHING_SERVER_AUTHORITY_REQUIRED'
    );
  }
});

test('D04 explicitly includes future authoritative attendance/package/grade/request protections', () => {
  for (const operation of [
    'grading.finalize',
    'assessment.package.lock',
    'attendance.authoritative.record',
    'request.formal.decide',
    'schedule.authority.update',
  ]) {
    assert.ok(FUTURE_PRIVILEGED_ACADEMIC_OPERATIONS.includes(operation));
  }
});

test('protected preparation requires explicit server-side authorization', () => {
  assert.equal(assertProtectedPreparationAccess({
    trustBoundary: 'server',
    protectedPreparationAuthorized: true,
  }), true);
  assert.throws(
    () => assertProtectedPreparationAccess({ trustBoundary: 'server' }),
    (error) => error.code === 'TEACHING_PROTECTED_PREPARATION_ACCESS_DENIED'
  );
  assert.throws(
    () => assertProtectedPreparationAccess({ trustBoundary: 'browser', protectedPreparationAuthorized: true }),
    (error) => error.code === 'TEACHING_PROTECTED_PREPARATION_ACCESS_DENIED'
  );
});

test('kernel persistence fails closed when D04 schema is incomplete', async () => {
  const persistence = createTeachingKernelPersistence({
    query: async () => ({ rows: [{
      courses: 'teaching_courses',
      course_plans: 'teaching_course_plans',
      eligibility: null,
      preparation_workspaces: 'workspaces',
      protected_payloads: 'prepared_artifact_payloads',
    }] }),
    withTransaction: async (fn) => fn({}),
  });
  await assert.rejects(
    persistence.assertReady(),
    (error) => error.code === 'TEACHING_D04_SCHEMA_NOT_READY'
  );
});

test('kernel persistence mutation seam runs inside the supplied transaction helper', async () => {
  const calls = [];
  const persistence = createTeachingKernelPersistence({
    query: async () => ({ rows: [] }),
    withTransaction: async (fn) => {
      calls.push('transaction');
      return fn({ query: async () => ({}) });
    },
  });
  const result = await persistence.mutate('coverage.persist', async () => 'committed-by-owner');
  assert.equal(result, 'committed-by-owner');
  assert.deepEqual(calls, ['transaction']);
});
