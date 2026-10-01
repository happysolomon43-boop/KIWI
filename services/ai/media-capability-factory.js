'use strict';

const { createProjectPool, createGroqCredentialPool } = require('./project-pool');
const { createGoogleProviderAdapter } = require('./google-provider-adapter');
const { createGroqProviderAdapter } = require('./groq-provider-adapter');
const { createMediaCapabilityRuntime } = require('./media-capability-runtime');

function createDefaultMediaCapabilityRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const projectPool = createProjectPool({ env });
  const groqCredentialPool = createGroqCredentialPool({ env });
  const googleAdapter = createGoogleProviderAdapter({ fetchImpl });
  const groqAdapter = createGroqProviderAdapter({ fetchImpl, logger });

  return createMediaCapabilityRuntime({
    env,
    groqAdapter,
    googleAdapter,
    groqCredentialPool,
    projectPool,
    logger,
  });
}

module.exports = {
  createDefaultMediaCapabilityRuntime,
};
