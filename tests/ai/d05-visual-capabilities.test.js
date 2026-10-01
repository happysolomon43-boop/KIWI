'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');
const {
  AI_VISUAL_CAPABILITIES,
  VISUAL_AUTHORITY,
  MAX_IMAGE_PROMPT_CHARACTERS,
  DEFAULT_IMAGE_GENERATION_STEPS,
  MAX_IMAGE_GENERATION_STEPS,
  SUPPORTED_DIAGRAM_TYPES,
  createImageGenerationRequest,
  inspectGeneratedImage,
  createDiagramRenderRequest,
  sanitizeSvg,
  diagramCacheKey,
} = require('../../services/ai/visual-contracts');
const { IMAGE_GENERATION_ROUTE } = require('../../services/ai/visual-model-catalog');
const {
  classifyCloudflareHttpError,
  createCloudflareImageTransport,
  CLOUDFLARE_IMAGE_QUOTA_POLICY,
} = require('../../services/ai/cloudflare-image-transport');
const { createKrokiRenderer } = require('../../services/ai/kroki-renderer');
const {
  createVisualCapabilityRuntime,
} = require('../../services/ai/visual-capability-runtime');
const { createDefaultVisualCapabilityRuntime } = require('../../services/ai/visual-capability-factory');
const { createModelCatalog } = require('../../services/ai/model-catalog');
const { createModelRouter } = require('../../services/ai/model-router');

function jpegBase64(width = 768, height = 512) {
  const bytes = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  return bytes.toString('base64');
}

function pngBase64(width = 640, height = 480) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  Buffer.from('IHDR', 'ascii').copy(bytes, 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

function response(status, body, contentType = 'application/json', extraHeaders = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        if (key === 'content-type') return contentType;
        return extraHeaders[key] ?? null;
      },
    },
    async text() { return text; },
  };
}

function fakeCloudflarePool(ids = ['cf-01']) {
  const disabled = new Set();
  const slots = () => ids.filter((id) => !disabled.has(id)).map((id) => ({ id, apiToken: `secret-${id}` }));
  return {
    orderedSlots: slots,
    peekOrderedSlots: slots,
    disable(id) { disabled.add(id); return true; },
    disabled,
  };
}

function minimalRuntime({ cloudflareGenerate, krokiRender, pool = fakeCloudflarePool(), env = {} } = {}) {
  const calls = { cloudflare: [], kroki: [] };
  const cloudflareTransport = {
    async generate(args) {
      calls.cloudflare.push(args);
      if (cloudflareGenerate) return cloudflareGenerate(args, calls.cloudflare.length);
      return { imageBase64: jpegBase64(), latencyMs: 6 };
    },
  };
  const krokiRenderer = krokiRender === null ? null : {
    async render(args) {
      calls.kroki.push(args);
      if (krokiRender) return krokiRender(args, calls.kroki.length);
      return {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><path d="M0 0h10"/></svg>',
        mimeType: 'image/svg+xml',
        latencyMs: 4,
      };
    },
  };
  return {
    runtime: createVisualCapabilityRuntime({
      env: { CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', ...env },
      cloudflareTransport,
      cloudflareCredentialPool: pool,
      krokiRenderer,
      logger: { warn() {}, info() {}, log() {} },
    }),
    calls,
    pool,
  };
}

test('D05 image request is illustrative-only, bounded, and provider-neutral', () => {
  const request = createImageGenerationRequest({
    prompt: 'An educational illustration of osmosis across a cell membrane',
    altText: 'Water moving across a cell membrane by osmosis',
    seed: 42,
  });
  assert.equal(request.capability, AI_VISUAL_CAPABILITIES.IMAGE_GENERATION);
  assert.equal(request.authority, VISUAL_AUTHORITY.ILLUSTRATIVE);
  assert.equal(request.steps, 33);
  assert.equal(request.steps, DEFAULT_IMAGE_GENERATION_STEPS);
  assert.equal(IMAGE_GENERATION_ROUTE.defaultSteps, 33);
  assert.equal(IMAGE_GENERATION_ROUTE.maxSteps, MAX_IMAGE_GENERATION_STEPS);
  assert.equal(IMAGE_GENERATION_ROUTE.modelId, '@cf/black-forest-labs/flux-2-dev');
  assert.equal(request.seed, 42);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'modelId'), false);
  assert.throws(
    () => createImageGenerationRequest({ prompt: 'x'.repeat(MAX_IMAGE_PROMPT_CHARACTERS + 1) }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
  assert.throws(
    () => createImageGenerationRequest({ prompt: 'Too many steps', steps: MAX_IMAGE_GENERATION_STEPS + 1 }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
});

test('D05 generated image validation checks base64, MIME signature, and dimensions', () => {
  const jpeg = inspectGeneratedImage(jpegBase64(768, 512), AI_PROVIDERS.CLOUDFLARE);
  assert.equal(jpeg.mimeType, 'image/jpeg');
  assert.equal(jpeg.width, 768);
  assert.equal(jpeg.height, 512);

  const png = inspectGeneratedImage(pngBase64(320, 240), AI_PROVIDERS.CLOUDFLARE);
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.width, 320);
  assert.equal(png.height, 240);

  assert.throws(
    () => inspectGeneratedImage(Buffer.from('not-an-image').toString('base64'), AI_PROVIDERS.CLOUDFLARE),
    (error) => error.code === AI_ERROR_CODES.INVALID_OUTPUT
  );
});

test('D05 Cloudflare transport uses FLUX.2 Dev multipart form data with 33 inference steps', async () => {
  const calls = [];
  const transport = createCloudflareImageTransport({
    endpointBase: 'https://api.cloudflare.test/client/v4',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { success: true, result: { image: jpegBase64() } });
    },
  });
  const request = createImageGenerationRequest({ prompt: 'A labelled-looking but text-free leaf illustration', seed: 7 });
  const result = await transport.generate({
    accountId: '0123456789abcdef0123456789abcdef',
    apiToken: 'top-secret-token',
    modelId: IMAGE_GENERATION_ROUTE.modelId,
    request,
    timeoutMs: 1000,
  });
  assert.equal(result.imageBase64, jpegBase64());
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/accounts\/0123456789abcdef0123456789abcdef\/ai\/run\/@cf\/black-forest-labs\/flux-2-dev$/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer top-secret-token');
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].options.headers, 'Content-Type'), false);
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.body.get('prompt'), request.prompt);
  assert.equal(calls[0].options.body.get('steps'), '33');
  assert.equal(calls[0].options.body.get('seed'), '7');
});

test('D05 Cloudflare account quota is classified account-wide and must not trigger token sweeping', async () => {
  assert.equal(CLOUDFLARE_IMAGE_QUOTA_POLICY.dailyAllocationScope, 'ACCOUNT');
  assert.equal(CLOUDFLARE_IMAGE_QUOTA_POLICY.rotateOnRateLimit, false);
  const quotaError = classifyCloudflareHttpError({
    status: 429,
    body: { errors: [{ code: 3036, message: 'daily free allocation exhausted' }] },
  });
  assert.equal(quotaError.code, AI_ERROR_CODES.RATE_LIMIT_RPD);
  assert.equal(quotaError.scope, 'ACCOUNT');

  const pool = fakeCloudflarePool(['cf-01', 'cf-02']);
  const { runtime, calls } = minimalRuntime({
    pool,
    cloudflareGenerate: async () => { throw quotaError; },
  });
  await assert.rejects(
    () => runtime.generateIllustrativeImage({ prompt: 'Educational cell illustration' }),
    (error) => error.code === AI_ERROR_CODES.RATE_LIMIT_RPD
  );
  assert.equal(calls.cloudflare.length, 1);
  assert.equal(calls.cloudflare[0].request.steps, 33);
  assert.equal(pool.disabled.size, 0);
});

test('D05 Cloudflare auth failure rotates token, then generated-image cache avoids duplicate inference', async () => {
  const pool = fakeCloudflarePool(['cf-01', 'cf-02']);
  const { runtime, calls } = minimalRuntime({
    pool,
    cloudflareGenerate: async ({ apiToken }) => {
      if (apiToken === 'secret-cf-01') {
        throw new AIError('bad token', {
          code: AI_ERROR_CODES.AUTH,
          retryable: false,
          scope: 'SLOT',
          provider: AI_PROVIDERS.CLOUDFLARE,
        });
      }
      return { imageBase64: jpegBase64(), latencyMs: 5 };
    },
  });
  const first = await runtime.generateIllustrativeImage({ prompt: 'A clean illustration of a mitochondrion', seed: 9 });
  assert.equal(first.provider, AI_PROVIDERS.CLOUDFLARE);
  assert.equal(first.modelId, '@cf/black-forest-labs/flux-2-dev');
  assert.equal(first.authority, VISUAL_AUTHORITY.ILLUSTRATIVE);
  assert.equal(first.cacheHit, false);
  assert.equal(calls.cloudflare.length, 2);
  assert.equal(calls.cloudflare[0].request.steps, 33);
  assert.ok(pool.disabled.has('cf-01'));

  const second = await runtime.generateIllustrativeImage({ prompt: 'A clean illustration of a mitochondrion', seed: 9 });
  assert.equal(second.cacheHit, true);
  assert.equal(calls.cloudflare.length, 2);
});

test('D05 diagram contract allowlists types and blocks external/import execution sources', () => {
  assert.ok(SUPPORTED_DIAGRAM_TYPES.includes('graphviz'));
  const request = createDiagramRenderRequest({
    diagramType: 'graphviz',
    source: 'digraph G { glucose -> pyruvate }',
    altText: 'Glucose to pyruvate pathway',
  });
  assert.equal(request.capability, AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER);
  assert.equal(request.authority, VISUAL_AUTHORITY.STRUCTURED_EXACT);
  assert.equal(request.outputFormat, 'svg');
  assert.equal(request.sourceHash.length, 64);

  assert.throws(
    () => createDiagramRenderRequest({ diagramType: 'html', source: '<b>x</b>' }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
  assert.throws(
    () => createDiagramRenderRequest({ diagramType: 'plantuml', source: '@startuml\n!includeurl https://evil.test/x\n@enduml' }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
});

test('D05 Kroki adapter posts structured source and requires SVG MIME', async () => {
  const calls = [];
  const renderer = createKrokiRenderer({
    baseUrl: 'https://kroki.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>', 'image/svg+xml; charset=utf-8');
    },
  });
  const request = createDiagramRenderRequest({ diagramType: 'graphviz', source: 'digraph G { A -> B }' });
  const result = await renderer.render({ request, timeoutMs: 1000 });
  assert.match(result.svg, /^<svg/);
  assert.equal(calls[0].url, 'https://kroki.test/');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    diagram_source: request.source,
    diagram_type: 'graphviz',
    output_format: 'svg',
  });
  assert.equal(calls[0].options.headers.Accept, 'image/svg+xml');
});

test('D05 SVG sanitizer permits local fragment references and rejects active/external content', () => {
  const safe = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect style="fill:url(#g)"/></svg>';
  assert.equal(sanitizeSvg(safe, AI_PROVIDERS.KROKI), safe);
  assert.throws(
    () => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', AI_PROVIDERS.KROKI),
    (error) => error.code === AI_ERROR_CODES.INVALID_OUTPUT
  );
  assert.throws(
    () => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.test"><text>x</text></a></svg>', AI_PROVIDERS.KROKI),
    (error) => error.code === AI_ERROR_CODES.INVALID_OUTPUT
  );
});

test('D05 structured diagram cache is deterministic and renderer failure degrades to text fallback', async () => {
  const { runtime, calls } = minimalRuntime();
  const args = { diagramType: 'graphviz', source: 'digraph G { A -> B }', fallbackText: 'A leads to B.' };
  const first = await runtime.renderStructuredDiagram(args);
  const second = await runtime.renderStructuredDiagram(args);
  assert.equal(first.degraded, false);
  assert.equal(first.provenance.deterministic, true);
  assert.equal(first.provenance.sanitized, true);
  assert.equal(second.cacheHit, true);
  assert.equal(calls.kroki.length, 1);

  const missing = minimalRuntime({ krokiRender: null });
  const degraded = await missing.runtime.renderStructuredDiagram(args);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.output.svg, null);
  assert.equal(degraded.fallback.text, 'A leads to B.');
  assert.equal(degraded.failure.code, AI_ERROR_CODES.CONFIG);
});

test('D05 diagram cache key is stable and changes with academic source', () => {
  const one = createDiagramRenderRequest({ diagramType: 'graphviz', source: 'digraph G { A -> B }' });
  const same = createDiagramRenderRequest({ diagramType: 'graphviz', source: 'digraph G { A -> B }' });
  const different = createDiagramRenderRequest({ diagramType: 'graphviz', source: 'digraph G { A -> C }' });
  assert.equal(diagramCacheKey(one), diagramCacheKey(same));
  assert.notEqual(diagramCacheKey(one), diagramCacheKey(different));
});

test('D05 factory keeps FLUX and Kroki configuration independent', () => {
  const runtime = createDefaultVisualCapabilityRuntime({
    env: {
      CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      CLOUDFLARE_WORKERS_AI_API_TOKEN: 'secret',
      // Deliberately no KROKI_BASE_URL.
    },
    fetchImpl: async () => { throw new Error('not called'); },
    logger: { warn() {}, info() {}, log() {} },
  });
  const status = runtime.status();
  assert.equal(status.imageGeneration.configured, true);
  assert.equal(status.imageGeneration.modelId, '@cf/black-forest-labs/flux-2-dev');
  assert.equal(status.imageGeneration.defaultSteps, 33);
  assert.equal(status.diagramRender.configured, false);
});

test('D05 visual modules do not alter ordinary text model routing', () => {
  const router = createModelRouter({
    catalog: createModelCatalog(),
    env: { AI_TEXT_PROVIDER_MODE: 'GOOGLE_ONLY' },
  });
  const before = router.resolveCandidates('QUICK_QUESTIONS').map((entry) => `${entry.provider}:${entry.modelId}`);
  // Constructing/using D05 contracts must not register or mutate text models.
  createImageGenerationRequest({ prompt: 'Illustrate diffusion' });
  createDiagramRenderRequest({ diagramType: 'graphviz', source: 'digraph G { A -> B }' });
  const after = router.resolveCandidates('QUICK_QUESTIONS').map((entry) => `${entry.provider}:${entry.modelId}`);
  assert.deepEqual(after, before);
  assert.ok(after.every((entry) => !entry.includes('CLOUDFLARE') && !entry.includes('KROKI')));
});
