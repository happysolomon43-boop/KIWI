'use strict';

const { AI_PROVIDERS } = require('./providers');
const { createKrokiRenderer } = require('./kroki-renderer');

function createKrokiProviderAdapter({ fetchImpl = globalThis.fetch, baseUrl, renderer = null } = {}) {
  const resolvedRenderer = renderer || createKrokiRenderer({ fetchImpl, baseUrl });

  async function renderDiagram({ request, timeoutMs, signal = null } = {}) {
    return resolvedRenderer.render({ request, timeoutMs, signal });
  }

  return Object.freeze({
    provider: AI_PROVIDERS.KROKI,
    renderDiagram,
  });
}

module.exports = { createKrokiProviderAdapter };
