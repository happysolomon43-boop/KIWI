'use strict';

const {
  assertServerAcademicMutation,
  assertProtectedPreparationAccess,
} = require('../security/d04-persistence-contract');

/**
 * D04 database seam. It deliberately exposes query/transaction primitives only
 * to server-side Teaching repositories. Domain services in later deliveries
 * remain responsible for academic rules and authoritative commits.
 */
function createTeachingKernelPersistence({ query, withTransaction }) {
  if (typeof query !== 'function') throw new TypeError('Teaching kernel persistence requires query().');
  if (typeof withTransaction !== 'function') throw new TypeError('Teaching kernel persistence requires withTransaction().');

  async function assertReady() {
    const { rows } = await query(`
      select
        to_regclass('public.teaching_courses') as courses,
        to_regclass('public.teaching_course_plans') as course_plans,
        to_regclass('public.teaching_assessment_eligibility') as eligibility,
        to_regclass('teaching_preparation.workspaces') as preparation_workspaces,
        to_regclass('teaching_protected.prepared_artifact_payloads') as protected_payloads
    `);
    const row = rows?.[0] || {};
    if (Object.values(row).some((value) => value == null)) {
      const error = new Error('Teaching D04 kernel schema is not ready.');
      error.code = 'TEACHING_D04_SCHEMA_NOT_READY';
      throw error;
    }
    return true;
  }

  async function mutate(operation, fn) {
    assertServerAcademicMutation(operation, { trustBoundary: 'server' });
    if (typeof fn !== 'function') throw new TypeError('Teaching kernel mutation requires a transaction function.');
    return withTransaction(fn);
  }

  async function protectedRead(context, fn) {
    assertProtectedPreparationAccess(context);
    if (typeof fn !== 'function') throw new TypeError('Protected preparation read requires a function.');
    return fn(query);
  }

  return Object.freeze({ assertReady, mutate, protectedRead });
}

module.exports = { createTeachingKernelPersistence };
