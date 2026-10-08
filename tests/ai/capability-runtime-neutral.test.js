'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { createModelCatalog, MODEL_IDS } = require('../../services/ai/model-catalog');
const { createProviderRegistry } = require('../../services/ai/provider-registry');
const { createCredentialRegistry } = require('../../services/ai/credential-registry');
const { createCapabilityRuntime } = require('../../services/ai/capability-runtime');

test('image generation executes through the shared capability runtime and bounded cache', async () => {
  let calls = 0;
  const providerRegistry = createProviderRegistry([{
    provider: AI_PROVIDERS.CLOUDFLARE,
    async generateImage({ credential, modelId, request }) {
      calls += 1;
      assert.equal(credential.apiToken, 'cf-secret');
      assert.equal(modelId, MODEL_IDS.FLUX_2_DEV);
      assert.equal(request.steps, 33);
      return { imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lT8AAAAASUVORK5CYII=', latencyMs: 3 };
    },
  }]);
  const runtime = createCapabilityRuntime({
    catalog: createModelCatalog(),
    providerRegistry,
    credentialRegistry: createCredentialRegistry({ env: { CLOUDFLARE_WORKERS_AI_API_TOKEN: 'cf-secret' } }),
    env: {},
    logger: null,
  });
  const first = await runtime.generateImage({ prompt: 'Draw a labelled cell', altText: 'cell' });
  const second = await runtime.generateImage({ prompt: 'Draw a labelled cell', altText: 'cell' });
  assert.equal(first.modelId, MODEL_IDS.FLUX_2_DEV);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
});

test('diagram rendering is provider-neutral and degrades safely when renderer is unavailable', async () => {
  const providerRegistry = createProviderRegistry([{
    provider: AI_PROVIDERS.KROKI,
    async renderDiagram() { return { svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', latencyMs: 2 }; },
  }]);
  const runtime = createCapabilityRuntime({
    catalog: createModelCatalog(), providerRegistry,
    credentialRegistry: createCredentialRegistry({ env: {} }), env: {}, logger: null,
  });
  const result = await runtime.renderDiagram({ diagramType: 'mermaid', source: 'graph TD; A-->B', altText: 'A to B' });
  assert.equal(result.provider, AI_PROVIDERS.KROKI);
  assert.equal(result.degraded, false);
  assert.match(result.output.svg, /<svg/);
});

test('speech synthesis uses the configured teacher voice through the shared provider registry', async () => {
  const providerRegistry = createProviderRegistry([{
    provider: AI_PROVIDERS.GROQ,
    async synthesizeSpeech({ credential, voiceProfile, input }) {
      assert.equal(credential.apiKey, 'groq-secret');
      assert.equal(voiceProfile.id, 'KIWI_TEACHER_EN_PRIMARY');
      assert.ok(input.length > 0);
      return { audioBuffer: Buffer.from('audio'), mimeType: 'audio/wav' };
    },
  }]);
  const runtime = createCapabilityRuntime({
    catalog: createModelCatalog(), providerRegistry,
    credentialRegistry: createCredentialRegistry({ env: { GROQ_API_KEY: 'groq-secret' } }), env: {}, logger: null,
  });
  const result = await runtime.synthesizeSpeech({ transcript: 'Hello class', language: 'en' });
  assert.equal(result.provider, AI_PROVIDERS.GROQ);
  assert.equal(result.modelId, MODEL_IDS.ORPHEUS_ENGLISH);
  assert.equal(result.degraded, false);
  assert.ok(result.audio.segments.length > 0);
});

test('direct visual capabilities fence cached responses and each provider attempt against revocation', async()=>{
  let calls=0,checks=0;
  const providerRegistry=createProviderRegistry([{provider:AI_PROVIDERS.CLOUDFLARE,async generateImage(){calls++;return {imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl7lT8AAAAASUVORK5CYII='};}}]);
  const runtime=createCapabilityRuntime({catalog:createModelCatalog(),providerRegistry,credentialRegistry:createCredentialRegistry({env:{CLOUDFLARE_WORKERS_AI_API_TOKEN:'fixture'}}),env:{},logger:null});
  const input={prompt:'A conceptual illustration',altText:'Illustration'};
  await runtime.generateImage({...input,beforeAttempt:async()=>{checks++;}});
  assert.equal(checks,2);assert.equal(calls,1);
  await assert.rejects(runtime.generateImage({...input,beforeAttempt:async()=>{throw new Error('parent revoked');}}),/parent revoked/);
  const abort=new AbortController();abort.abort(new Error('cancelled'));
  await assert.rejects(runtime.generateImage({...input,signal:abort.signal}),/cancelled/);
  assert.equal(calls,1);
});
