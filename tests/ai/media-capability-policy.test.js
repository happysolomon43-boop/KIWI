'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AIError, AI_ERROR_CODES } = require('../../services/ai/errors');
const {
  VISION_PROVIDER_MODES,
  TEACHER_VOICE_MODES,
  VOICE_DISABLED_CODE,
  createMediaCapabilityRuntime,
} = require('../../services/ai/media-capability-runtime');

function pngBase64() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ]).toString('base64');
}

function visionParts() {
  return [
    { type: 'text', text: 'Inspect the image.' },
    { type: 'image', mimeType: 'image/png', data: pngBase64() },
  ];
}

function googleSuccess(text = 'google vision ok') {
  return {
    raw: {
      candidates: [{
        content: { parts: [{ text }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {},
    },
    latencyMs: 1,
  };
}

function createRuntime({
  env = {},
  groqGenerate = async () => ({ normalized: { text: 'qwen vision ok' }, latencyMs: 1 }),
  googleGenerate = async () => googleSuccess(),
  synthesizeSpeech = async () => ({
    audioBuffer: Buffer.from('RIFF0000WAVE', 'ascii'),
    mimeType: 'audio/wav',
    latencyMs: 1,
  }),
  onGroqPool = null,
} = {}) {
  return createMediaCapabilityRuntime({
    env,
    groqAdapter: {
      generate: groqGenerate,
      synthesizeSpeech,
    },
    googleAdapter: {
      generate: googleGenerate,
    },
    groqCredentialPool: {
      orderedSlots(routeKey) {
        onGroqPool?.(routeKey);
        return [{ id: 'groq-test-01', apiKey: 'not-a-real-secret' }];
      },
      disable() { return true; },
    },
    projectPool: {
      orderedSlots() {
        return [{ id: 'google-test-01', apiKey: 'not-a-real-secret' }];
      },
      disable() { return true; },
    },
    logger: { warn() {}, info() {}, log() {} },
  });
}

test('D04 GOOGLE_ONLY rollback bypasses Qwen and exposes the effective route mode', async () => {
  let groqCalls = 0;
  let googleCalls = 0;
  const runtime = createRuntime({
    env: { AI_VISION_PROVIDER_MODE: 'GOOGLE_ONLY' },
    groqGenerate: async () => {
      groqCalls += 1;
      throw new Error('Qwen must not run in GOOGLE_ONLY mode');
    },
    googleGenerate: async () => {
      googleCalls += 1;
      return googleSuccess('google rollback ok');
    },
  });

  const response = await runtime.analyzeVision({ parts: visionParts() });
  const status = runtime.status();

  assert.equal(response.text, 'google rollback ok');
  assert.equal(groqCalls, 0);
  assert.equal(googleCalls, 1);
  assert.equal(status.vision.mode, VISION_PROVIDER_MODES.GOOGLE_ONLY);
  assert.equal(status.vision.routes.length, 1);
  assert.equal(status.vision.routes[0].provider, AI_PROVIDERS.GOOGLE);
});

test('D04 BAD_REQUEST from Qwen is terminal and cannot be bypassed by Gemini fallback', async () => {
  let googleCalls = 0;
  const runtime = createRuntime({
    groqGenerate: async () => {
      throw new AIError('invalid multimodal request', {
        code: AI_ERROR_CODES.BAD_REQUEST,
        retryable: false,
        scope: 'REQUEST',
        provider: AI_PROVIDERS.GROQ,
      });
    },
    googleGenerate: async () => {
      googleCalls += 1;
      return googleSuccess();
    },
  });

  await assert.rejects(
    runtime.analyzeVision({ parts: visionParts() }),
    (error) => error?.code === AI_ERROR_CODES.BAD_REQUEST
  );
  assert.equal(googleCalls, 0);
});

test('D04 SAFETY failure from Qwen is terminal and cannot be bypassed by Gemini fallback', async () => {
  let googleCalls = 0;
  const runtime = createRuntime({
    groqGenerate: async () => {
      throw new AIError('vision safety refusal', {
        code: AI_ERROR_CODES.SAFETY,
        retryable: false,
        scope: 'REQUEST',
        provider: AI_PROVIDERS.GROQ,
      });
    },
    googleGenerate: async () => {
      googleCalls += 1;
      return googleSuccess();
    },
  });

  await assert.rejects(
    runtime.analyzeVision({ parts: visionParts() }),
    (error) => error?.code === AI_ERROR_CODES.SAFETY
  );
  assert.equal(googleCalls, 0);
});

test('D04 DISABLED teacher voice rollback preserves transcript and makes no Groq TTS request', async () => {
  let speechCalls = 0;
  let groqPoolCalls = 0;
  const transcript = 'This academic transcript remains authoritative when voice is disabled.';
  const runtime = createRuntime({
    env: {
      AI_TEACHER_VOICE_MODE: 'DISABLED',
      AI_TEACHER_VOICE_ID: 'KIWI_TEACHER_EN_PRIMARY',
    },
    synthesizeSpeech: async () => {
      speechCalls += 1;
      throw new Error('TTS must not run when disabled');
    },
    onGroqPool: () => { groqPoolCalls += 1; },
  });

  const response = await runtime.synthesizeTeacherVoice({ transcript, language: 'en' });
  const status = runtime.status();

  assert.equal(response.transcript, transcript);
  assert.equal(response.degraded, true);
  assert.deepEqual(response.segments, []);
  assert.equal(response.failure.code, VOICE_DISABLED_CODE);
  assert.equal(speechCalls, 0);
  assert.equal(groqPoolCalls, 0);
  assert.equal(status.speech.mode, TEACHER_VOICE_MODES.DISABLED);
});

test('D04 defaults remain Qwen-first vision and Orpheus teacher voice', () => {
  const runtime = createRuntime();
  const status = runtime.status();

  assert.equal(status.vision.mode, VISION_PROVIDER_MODES.QWEN_FIRST);
  assert.equal(status.vision.routes[0].provider, AI_PROVIDERS.GROQ);
  assert.equal(status.speech.mode, TEACHER_VOICE_MODES.ORPHEUS);
});
