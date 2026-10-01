'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');
const {
  AI_CONTENT_KINDS,
  AI_CONTENT_PART_KINDS,
  AI_MEDIA_CAPABILITIES,
  MAX_VISION_IMAGES,
  MAX_SPEECH_CHUNK_CHARACTERS,
  createImageContentPart,
  createMultimodalContent,
  createExecutionRequest,
  createExecutionResponse,
  createSpeechSynthesisRequest,
  createSpeechSynthesisResponse,
  splitSpeechTranscript,
} = require('../../services/ai/execution-contracts');
const {
  serializeGroqExecutionRequest,
  serializeGroqSpeechRequest,
} = require('../../services/ai/groq-provider-adapter');
const { serializeGoogleExecutionRequest } = require('../../services/ai/google-provider-adapter');
const {
  VISION_ROUTES,
  TEACHER_VOICE_PROFILES,
} = require('../../services/ai/media-model-catalog');
const { createMediaTelemetry } = require('../../services/ai/media-telemetry');
const {
  DEFAULT_VISION_TIMEOUT_MS,
  DEFAULT_SPEECH_TIMEOUT_MS,
  createMediaCapabilityRuntime,
} = require('../../services/ai/media-capability-runtime');

function pngBase64(extraBytes = 0) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extraBytes, 0),
  ]).toString('base64');
}

function jpegBase64(extraBytes = 0) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(extraBytes, 0),
  ]).toString('base64');
}

function imagePart(mimeType = 'image/png') {
  return {
    type: 'image',
    mimeType,
    data: mimeType === 'image/png' ? pngBase64() : jpegBase64(),
  };
}

function fakePool(ids) {
  const disabled = new Set();
  return {
    orderedSlots() {
      return ids
        .filter((id) => !disabled.has(id))
        .map((id) => ({ id, apiKey: `secret-${id}` }));
    },
    disable(id) {
      disabled.add(id);
      return true;
    },
    disabled,
  };
}

function geminiRaw(text = 'gemini vision ok') {
  return {
    candidates: [{
      content: { parts: [{ text }] },
      finishReason: 'STOP',
    }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
  };
}

function groqVisionResponse(text = 'qwen vision ok', structuredData = null) {
  return createExecutionResponse({
    provider: AI_PROVIDERS.GROQ,
    requestedModel: VISION_ROUTES[0].modelId,
    providerModel: VISION_ROUTES[0].modelId,
    text,
    structuredData,
    finishReason: 'STOP',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });
}

function createRuntime({
  groqGenerate,
  groqSpeech,
  googleGenerate,
  groqIds = ['groq-01'],
  googleIds = ['google-01'],
  env = {},
  telemetry = null,
} = {}) {
  const groqCredentialPool = fakePool(groqIds);
  const projectPool = fakePool(googleIds);
  const calls = {
    groqGenerate: [],
    groqSpeech: [],
    googleGenerate: [],
  };

  const groqAdapter = {
    async generate(args) {
      calls.groqGenerate.push(args);
      if (groqGenerate) return groqGenerate(args, calls.groqGenerate.length);
      return {
        normalized: groqVisionResponse(),
        latencyMs: 10,
      };
    },
    async synthesizeSpeech(args) {
      calls.groqSpeech.push(args);
      if (groqSpeech) return groqSpeech(args, calls.groqSpeech.length);
      return {
        audioBuffer: Buffer.from('RIFF0000WAVE', 'ascii'),
        mimeType: 'audio/wav',
        latencyMs: 8,
      };
    },
  };

  const googleAdapter = {
    async generate(args) {
      calls.googleGenerate.push(args);
      if (googleGenerate) return googleGenerate(args, calls.googleGenerate.length);
      return { raw: geminiRaw(), latencyMs: 12 };
    },
  };

  return {
    runtime: createMediaCapabilityRuntime({
      env,
      groqAdapter,
      googleAdapter,
      groqCredentialPool,
      projectPool,
      telemetry,
      logger: { warn() {}, info() {}, log() {} },
    }),
    calls,
    groqCredentialPool,
    projectPool,
  };
}

test('D04 neutral image contract validates MIME, signatures, counts and metadata', () => {
  const content = createMultimodalContent([
    { type: 'text', text: 'Compare the two figures.' },
    imagePart('image/png'),
    imagePart('image/jpeg'),
  ]);

  assert.equal(content.kind, AI_CONTENT_KINDS.MULTIMODAL);
  assert.equal(content.parts[0].kind, AI_CONTENT_PART_KINDS.TEXT);
  assert.equal(content.media.imageCount, 2);
  assert.deepEqual([...content.media.imageMimeTypes].sort(), ['image/jpeg', 'image/png']);
  assert.ok(content.media.totalImageBytes > 0);

  assert.throws(
    () => createImageContentPart({ mimeType: 'image/gif', data: pngBase64() }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
  assert.throws(
    () => createImageContentPart({ mimeType: 'image/png', data: jpegBase64() }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );

  const tooMany = [{ type: 'text', text: 'Inspect.' }];
  for (let index = 0; index < MAX_VISION_IMAGES + 1; index++) {
    tooMany.push(imagePart());
  }
  assert.throws(
    () => createMultimodalContent(tooMany),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
});

test('D04 provider conversion boundary serializes one neutral image request for Qwen and Gemini', () => {
  const content = createMultimodalContent([
    { type: 'text', text: 'Read this image.' },
    imagePart(),
  ]);

  const groqRequest = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: VISION_ROUTES[0].modelId,
    content,
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      maxOutputTokens: 900,
      structuredOutput: {
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    },
  });
  const groqBody = serializeGroqExecutionRequest(groqRequest);
  assert.equal(groqBody.model, VISION_ROUTES[0].modelId);
  assert.equal(groqBody.messages[0].content[0].type, 'text');
  assert.equal(groqBody.messages[0].content[1].type, 'image_url');
  assert.match(groqBody.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(groqBody.reasoning_effort, 'high');
  assert.equal(groqBody.reasoning_format, 'hidden');
  assert.equal(groqBody.max_completion_tokens, 900);
  assert.equal(groqBody.response_format.type, 'json_schema');

  const googleRequest = createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: VISION_ROUTES[1].modelId,
    content,
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
    },
  });
  const googleBody = serializeGoogleExecutionRequest(googleRequest);
  assert.equal(googleBody.contents[0].parts[0].text, 'Read this image.');
  assert.equal(googleBody.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(googleBody.contents[0].parts[1].inlineData.data, pngBase64());
  assert.equal(googleBody.generationConfig.thinkingConfig.thinkingLevel, 'high');
});

test('D04 Qwen vision succeeds as primary and preserves structured-output directives', async () => {
  let seenRequest = null;
  const { runtime, calls } = createRuntime({
    groqGenerate: async ({ request, timeoutMs }) => {
      seenRequest = request;
      assert.equal(timeoutMs, DEFAULT_VISION_TIMEOUT_MS);
      return {
        normalized: groqVisionResponse('', { answer: '42' }),
        latencyMs: 17,
      };
    },
  });

  const response = await runtime.analyzeVision({
    parts: [
      { type: 'text', text: 'Return the result.' },
      imagePart(),
    ],
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      structuredOutput: {
        schema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        },
      },
    },
  });

  assert.equal(response.provider, AI_PROVIDERS.GROQ);
  assert.deepEqual(response.structuredData, { answer: '42' });
  assert.equal(seenRequest.content.kind, AI_CONTENT_KINDS.MULTIMODAL);
  assert.equal(seenRequest.generation.reasoning.resolved, 'HIGH');
  assert.equal(seenRequest.generation.structuredOutput.schema.required[0], 'answer');
  assert.equal(calls.groqGenerate.length, 1);
  assert.equal(calls.googleGenerate.length, 0);
});

test('D04 vision outage simulation translates the same image input to qualified Gemini backup', async () => {
  const { runtime, calls } = createRuntime({
    groqGenerate: async () => {
      throw new AIError('simulated Groq outage', {
        code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
        retryable: true,
        provider: AI_PROVIDERS.GROQ,
      });
    },
  });

  const response = await runtime.analyzeVision({
    parts: [
      { type: 'text', text: 'Describe the image.' },
      imagePart('image/jpeg'),
    ],
  });

  assert.equal(response.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(response.text, 'gemini vision ok');
  assert.equal(response.fallbackDepth, 1);
  assert.equal(calls.groqGenerate.length, 1);
  assert.equal(calls.googleGenerate.length, 1);
  assert.equal(calls.googleGenerate[0].request.content.kind, AI_CONTENT_KINDS.MULTIMODAL);
  assert.equal(calls.googleGenerate[0].request.content.media.imageCount, 1);
  assert.equal(calls.googleGenerate[0].request.content.parts[1].mimeType, 'image/jpeg');
});

test('D04 Qwen auth failure rotates credential but shared/transient failures do not sweep keys', async () => {
  const authCase = createRuntime({
    groqIds: ['groq-01', 'groq-02'],
    groqGenerate: async ({ credential }) => {
      if (credential.id === 'groq-01') {
        throw new AIError('bad key', {
          code: AI_ERROR_CODES.AUTH,
          retryable: false,
          provider: AI_PROVIDERS.GROQ,
        });
      }
      return { normalized: groqVisionResponse('rotated'), latencyMs: 5 };
    },
  });

  const rotated = await authCase.runtime.analyzeVision({
    parts: [{ type: 'text', text: 'Inspect.' }, imagePart()],
  });
  assert.equal(rotated.text, 'rotated');
  assert.equal(authCase.calls.groqGenerate.length, 2);
  assert.ok(authCase.groqCredentialPool.disabled.has('groq-01'));
  assert.equal(authCase.calls.googleGenerate.length, 0);

  const rateLimitCase = createRuntime({
    groqIds: ['groq-01', 'groq-02'],
    groqGenerate: async () => {
      throw new AIError('shared provider rate limit', {
        code: AI_ERROR_CODES.RATE_LIMIT_RPM,
        retryable: true,
        provider: AI_PROVIDERS.GROQ,
      });
    },
  });
  const fallback = await rateLimitCase.runtime.analyzeVision({
    parts: [{ type: 'text', text: 'Inspect.' }, imagePart()],
  });
  assert.equal(fallback.provider, AI_PROVIDERS.GOOGLE);
  assert.equal(rateLimitCase.calls.groqGenerate.length, 1);
  assert.equal(rateLimitCase.calls.googleGenerate.length, 1);
});

test('D04 reports capability exhaustion only after both vision providers fail', async () => {
  const { runtime } = createRuntime({
    groqGenerate: async () => {
      throw new AIError('groq down', {
        code: AI_ERROR_CODES.TRANSIENT,
        retryable: true,
        provider: AI_PROVIDERS.GROQ,
      });
    },
    googleGenerate: async () => {
      throw new AIError('google down', {
        code: AI_ERROR_CODES.TRANSIENT,
        retryable: true,
        provider: AI_PROVIDERS.GOOGLE,
      });
    },
  });

  await assert.rejects(
    () => runtime.analyzeVision({
      parts: [{ type: 'text', text: 'Inspect.' }, imagePart()],
    }),
    (error) => error.code === AI_ERROR_CODES.CAPACITY_EXHAUSTED
  );
});

test('D04 speech contract chunks long transcripts without changing the authoritative transcript', () => {
  const transcript = `${'A'.repeat(160)}. ${'B'.repeat(160)}. ${'C'.repeat(160)}.`;
  const request = createSpeechSynthesisRequest({ transcript });
  const chunks = splitSpeechTranscript(request.transcript);

  assert.equal(request.capability, AI_MEDIA_CAPABILITIES.SPEECH_SYNTHESIS);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= MAX_SPEECH_CHUNK_CHARACTERS));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), transcript.replace(/\s+/g, ' ').trim());

  const degraded = createSpeechSynthesisResponse({
    transcript,
    voiceId: request.voiceId,
    segments: [],
    degraded: true,
    failure: { code: AI_ERROR_CODES.TIMEOUT, retryable: true },
  });
  assert.equal(degraded.transcript, transcript);
  assert.equal(degraded.audio.segments.length, 0);
  assert.equal(degraded.degraded, true);
});

test('D04 Orpheus request serialization enforces selected voice and 200-character chunk limit', () => {
  const request = createSpeechSynthesisRequest({
    transcript: 'Explain this step.',
    voiceId: 'KIWI_TEACHER_EN_PRIMARY',
  });
  const profile = TEACHER_VOICE_PROFILES.KIWI_TEACHER_EN_PRIMARY;
  const body = serializeGroqSpeechRequest({
    request,
    voiceProfile: profile,
    input: 'Explain this step.',
  });

  assert.equal(body.model, profile.modelId);
  assert.equal(body.voice, profile.providerVoice);
  assert.equal(body.response_format, 'wav');
  assert.equal(body.input, 'Explain this step.');
  assert.throws(
    () => serializeGroqSpeechRequest({
      request,
      voiceProfile: profile,
      input: 'x'.repeat(MAX_SPEECH_CHUNK_CHARACTERS + 1),
    }),
    (error) => error.code === AI_ERROR_CODES.BAD_REQUEST
  );
});

test('D04 Orpheus success emits segmented WAV payload metadata and keeps one credential affinity', async () => {
  const transcript = `${'Alpha '.repeat(40)}${'Beta '.repeat(40)}`.trim();
  const { runtime, calls } = createRuntime({
    groqSpeech: async ({ input, timeoutMs }) => {
      assert.ok(input.length <= MAX_SPEECH_CHUNK_CHARACTERS);
      assert.equal(timeoutMs, DEFAULT_SPEECH_TIMEOUT_MS);
      return {
        audioBuffer: Buffer.from('RIFF0000WAVE', 'ascii'),
        mimeType: 'audio/wav',
        latencyMs: 4,
      };
    },
  });

  const response = await runtime.synthesizeTeacherVoice({ transcript });
  assert.equal(response.transcript, transcript);
  assert.equal(response.provider, AI_PROVIDERS.GROQ);
  assert.equal(response.degraded, false);
  assert.ok(response.audio.segments.length > 1);
  assert.ok(response.audio.segments.every((segment) => segment.mimeType === 'audio/wav'));
  assert.ok(calls.groqSpeech.every((call) => call.credential.id === 'groq-01'));
});

test('D04 TTS auth failure rotates credential and non-auth outage degrades to text only', async () => {
  const rotation = createRuntime({
    groqIds: ['groq-01', 'groq-02'],
    groqSpeech: async ({ credential }) => {
      if (credential.id === 'groq-01') {
        throw new AIError('bad key', {
          code: AI_ERROR_CODES.AUTH,
          retryable: false,
          provider: AI_PROVIDERS.GROQ,
        });
      }
      return {
        audioBuffer: Buffer.from('RIFF0000WAVE', 'ascii'),
        mimeType: 'audio/wav',
        latencyMs: 3,
      };
    },
  });
  const rotated = await rotation.runtime.synthesizeTeacherVoice({
    transcript: 'A short teacher explanation.',
  });
  assert.equal(rotated.degraded, false);
  assert.equal(rotated.credentialSlot, 'groq-02');
  assert.ok(rotation.groqCredentialPool.disabled.has('groq-01'));

  const outage = createRuntime({
    groqIds: ['groq-01', 'groq-02'],
    groqSpeech: async () => {
      throw new AIError('provider busy', {
        code: AI_ERROR_CODES.PROVIDER_OVERLOADED,
        retryable: true,
        provider: AI_PROVIDERS.GROQ,
      });
    },
  });
  const transcript = 'The academic content must remain readable when voice is unavailable.';
  const degraded = await outage.runtime.synthesizeTeacherVoice({ transcript });
  assert.equal(degraded.transcript, transcript);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.audio.segments.length, 0);
  assert.equal(degraded.failure.code, AI_ERROR_CODES.PROVIDER_OVERLOADED);
  assert.equal(outage.calls.groqSpeech.length, 1);
});

test('D04 missing TTS credentials is a text-only degradation, not an academic failure', async () => {
  const { runtime } = createRuntime({ groqIds: [] });
  const transcript = 'This transcript remains the source of truth.';
  const response = await runtime.synthesizeTeacherVoice({ transcript });

  assert.equal(response.transcript, transcript);
  assert.equal(response.degraded, true);
  assert.equal(response.failure.code, AI_ERROR_CODES.CONFIG);
  assert.equal(response.audio.segments.length, 0);
});

test('D04 multimodal telemetry is capability-specific and never records prompt, image or transcript contents', async () => {
  const telemetry = createMediaTelemetry({
    logger: { warn() {} },
    clock: () => 1000,
  });
  const { runtime } = createRuntime({ telemetry });
  const secretTranscript = 'DO_NOT_RECORD_THIS_TRANSCRIPT';
  const secretImage = pngBase64();

  await runtime.analyzeVision({
    parts: [
      { type: 'text', text: 'DO_NOT_RECORD_THIS_PROMPT' },
      { type: 'image', mimeType: 'image/png', data: secretImage },
    ],
  });
  await runtime.synthesizeTeacherVoice({ transcript: secretTranscript });

  const serialized = JSON.stringify(telemetry.snapshot());
  assert.doesNotMatch(serialized, /DO_NOT_RECORD_THIS_PROMPT/);
  assert.doesNotMatch(serialized, /DO_NOT_RECORD_THIS_TRANSCRIPT/);
  assert.equal(serialized.includes(secretImage), false);
  assert.match(serialized, /VISION/);
  assert.match(serialized, /SPEECH_SYNTHESIS/);
});

test('D04 status exposes independent capability routes and timeout policy without credentials', () => {
  const { runtime } = createRuntime({
    env: {
      AI_VISION_ATTEMPT_TIMEOUT_MS: '17000',
      AI_SPEECH_ATTEMPT_TIMEOUT_MS: '12000',
    },
  });
  const status = runtime.status();

  assert.equal(status.vision.timeoutMs, 17000);
  assert.equal(status.speech.timeoutMs, 12000);
  assert.equal(status.vision.routes[0].provider, AI_PROVIDERS.GROQ);
  assert.equal(status.vision.routes[0].role, 'PRIMARY');
  assert.equal(status.vision.routes[1].provider, AI_PROVIDERS.GOOGLE);
  assert.equal(status.vision.routes[1].role, 'FALLBACK');
  assert.doesNotMatch(JSON.stringify(status), /secret-/);
});
