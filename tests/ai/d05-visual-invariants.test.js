'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDefaultVisualCapabilityRuntime } = require('../../services/ai/visual-capability-factory');
const { createVisualTelemetry } = require('../../services/ai/visual-telemetry');

test('D05 Kroki remains independently configured when Cloudflare image generation is absent', () => {
  const runtime = createDefaultVisualCapabilityRuntime({
    env: {
      KROKI_BASE_URL: 'https://kroki.test',
      // Deliberately no Cloudflare account ID or token.
    },
    fetchImpl: async () => { throw new Error('not called'); },
    logger: { warn() {}, info() {}, log() {} },
  });

  const status = runtime.status();
  assert.equal(status.imageGeneration.configured, false);
  assert.equal(status.diagramRender.configured, true);
});

test('D05 visual telemetry cannot retain prompts, diagram source, provider bytes, or credential values', () => {
  const telemetry = createVisualTelemetry({
    logger: { warn() {}, info() {}, log() {} },
    clock: () => Date.parse('2026-10-01T00:00:00Z'),
  });

  telemetry.record({
    capability: 'IMAGE_GENERATION',
    outcome: 'SUCCESS',
    provider: 'CLOUDFLARE',
    modelId: '@cf/black-forest-labs/flux-1-schnell',
    credentialSlot: 'cloudflare-token-01',
    latencyMs: 123,
    mimeType: 'image/jpeg',
    byteLength: 4096,
    width: 768,
    height: 512,
    // These are intentionally supplied to prove the telemetry schema drops them.
    prompt: 'SECRET_PROMPT_SHOULD_NOT_SURVIVE',
    source: 'SECRET_DIAGRAM_SOURCE_SHOULD_NOT_SURVIVE',
    data: 'SECRET_BASE64_SHOULD_NOT_SURVIVE',
    apiToken: 'SECRET_TOKEN_SHOULD_NOT_SURVIVE',
  });

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.length, 1);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /SECRET_PROMPT_SHOULD_NOT_SURVIVE/);
  assert.doesNotMatch(serialized, /SECRET_DIAGRAM_SOURCE_SHOULD_NOT_SURVIVE/);
  assert.doesNotMatch(serialized, /SECRET_BASE64_SHOULD_NOT_SURVIVE/);
  assert.doesNotMatch(serialized, /SECRET_TOKEN_SHOULD_NOT_SURVIVE/);
  assert.match(serialized, /cloudflare-token-01/);
});
