'use strict';

const { Pool } = require('pg');

const PRODUCTION_PROJECT_REF = 'nqdwifqskxkblgdgeutn';

function assertNonProductionDatabase({ connectionString, projectRef }) {
  if (!connectionString) throw new Error('TEACHING_TEST_DATABASE_URL is required.');
  if (!projectRef) throw new Error('TEACHING_TEST_PROJECT_REF is required.');
  if (projectRef === PRODUCTION_PROJECT_REF || connectionString.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Teaching integration tests refuse to run against production KIWI Supabase.');
  }
  return true;
}

function integrationConfig(scope = 'Teaching') {
  const connectionString = process.env.TEACHING_TEST_DATABASE_URL;
  const projectRef = process.env.TEACHING_TEST_PROJECT_REF;
  return Object.freeze({
    connectionString,
    projectRef,
    skipReason: (!connectionString || !projectRef)
      ? `No non-production database configured for ${scope} integration tests.`
      : false,
  });
}

function createIntegrationPool(connectionString) {
  if (!connectionString) throw new Error('TEACHING_TEST_DATABASE_URL is required.');
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  return new Pool({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
}

module.exports = {
  PRODUCTION_PROJECT_REF,
  assertNonProductionDatabase,
  integrationConfig,
  createIntegrationPool,
};
