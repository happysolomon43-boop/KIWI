'use strict';

const { AI_PROVIDERS } = require('./providers');
const { createCloudflareImageTransport } = require('./cloudflare-image-transport');

function createCloudflareProviderAdapter({
  fetchImpl = globalThis.fetch,
  endpointBase,
  accountId,
  transport = null,
} = {}) {
  const resolvedTransport = transport || createCloudflareImageTransport({ fetchImpl, endpointBase });
  const resolvedAccountId = String(accountId || '').trim();

  async function generateImage({ credential, modelId, request, timeoutMs = 120000, signal = null } = {}) {
    const apiToken = typeof credential === 'string' ? credential : credential?.apiToken;
    return resolvedTransport.generate({
      accountId: resolvedAccountId,
      apiToken,
      modelId,
      request,
      timeoutMs,
      signal,
    });
  }

  return Object.freeze({
    provider: AI_PROVIDERS.CLOUDFLARE,
    quotaPolicy: resolvedTransport.quotaPolicy,
    generateImage,
  });
}

module.exports = { createCloudflareProviderAdapter };
