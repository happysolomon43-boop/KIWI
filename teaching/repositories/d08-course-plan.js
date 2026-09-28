'use strict';

const { createPlanReader } = require('./d08/plan-reader');
const { createPlanWriter } = require('./d08/plan-writer');
const { createCoverageStore } = require('./d08/coverage-store');
const { createScopeStore } = require('./d08/scope-store');
const { createVpkStore } = require('./d08/vpk-store');

function createD08CoursePlanRepository({ query, withTransaction, randomUUID, clock = () => new Date() } = {}) {
  if (typeof query !== 'function' || typeof withTransaction !== 'function' || typeof randomUUID !== 'function') {
    throw new TypeError('D08 repository requires query, withTransaction and randomUUID.');
  }
  const ctx = Object.freeze({
    query,
    withTransaction,
    randomUUID,
    clock,
    q: (runner, sql, params = []) => {
      if (!runner) return query(sql, params);
      return typeof runner === 'function' ? runner(sql, params) : runner.query(sql, params);
    },
    json: (value) => JSON.stringify(value ?? null),
  });
  return Object.freeze({
    ...createPlanReader(ctx),
    ...createPlanWriter(ctx),
    ...createCoverageStore(ctx),
    ...createScopeStore(ctx),
    ...createVpkStore(ctx),
  });
}

module.exports = { createD08CoursePlanRepository };
