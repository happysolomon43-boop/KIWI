'use strict';

const {
  normalizeGoogleContents,
  readResponseBody,
} = require('./google-http-transport');
const {
  createGoogleProviderAdapter,
} = require('./google-provider-adapter');

// Backward-compatible alias retained for callers/tests while the central
// orchestrator migrates to explicit provider adapters. The actual production
// path now enters the provider-neutral execution contract inside the Google
// adapter before any Google-specific HTTP serialization occurs.
function createGeminiTransport(options = {}) {
  return createGoogleProviderAdapter(options).legacyTransport;
}

module.exports = {
  normalizeContents: normalizeGoogleContents,
  readResponseBody,
  createGeminiTransport,
};
