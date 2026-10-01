'use strict';

const { createCloudflareCredentialPool } = require('./project-pool');
const { createCloudflareImageTransport } = require('./cloudflare-image-transport');
const { createKrokiRenderer } = require('./kroki-renderer');
const { createVisualCapabilityRuntime } = require('./visual-capability-runtime');

function createDefaultVisualCapabilityRuntime({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const cloudflareCredentialPool = createCloudflareCredentialPool({ env });
  const cloudflareTransport = createCloudflareImageTransport({ fetchImpl });
  // Kroki is deliberately optional at construction time. A missing renderer
  // configuration degrades only DIAGRAM_RENDER and must not disable FLUX.
  const krokiRenderer = String(env.KROKI_BASE_URL || '').trim()
    ? createKrokiRenderer({ fetchImpl, baseUrl: env.KROKI_BASE_URL })
    : null;

  return createVisualCapabilityRuntime({
    env,
    cloudflareTransport,
    cloudflareCredentialPool,
    krokiRenderer,
    logger,
  });
}

module.exports = { createDefaultVisualCapabilityRuntime };
