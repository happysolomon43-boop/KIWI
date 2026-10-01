'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { AI_ERROR_CODES } = require('../../services/ai/errors');
const {
  MAX_VISION_IMAGE_BYTES,
  createImageContentPart,
  createMultimodalContent,
  createExecutionRequest,
} = require('../../services/ai/execution-contracts');
const {
  serializeGroqExecutionRequest,
} = require('../../services/ai/groq-provider-adapter');
const {
  serializeGoogleExecutionRequest,
} = require('../../services/ai/google-provider-adapter');
const {
  VISION_ROUTES,
  TEACHER_VOICE_PROFILES,
  resolveTeacherVoice,
} = require('../../services/ai/media-model-catalog');
const {
  createMediaCapabilityRuntime,
} = require('../../services/ai/media-capability-runtime');

function webpBase64(extraBytes = 0) {
  const header = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
  ]);
  return Buffer.concat([header, Buffer.alloc(extraBytes, 0)]).toString('base64');
}

function pngBase64(byteLength) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    Buffer.alloc(Math.max(0, byteLength - signature.length), 0),
  ]).toString('base64');
}

test('D04 accepts validated WebP and translates it at provider boundaries', () => {
  const image = createImageContentPart({
    mimeType: 'image/webp',
    data: webpBase64(),
  });
  assert.equal(image.mimeType, 'image/webp');

  const content = createMultimodalContent([
    { type: 'text', text: 'Inspect this WebP image.' },
    { type: 'image', mimeType: 'image/webp', data: webpBase64() },
  ]);

  const groqBody = serializeGroqExecutionRequest(createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: VISION_ROUTES[0].modelId,
    content,
  }));
  assert.match(
    groqBody.messages[0].content[1].image_url.url,
    /^data:image\/webp;base64,/
  );

  const googleBody = serializeGoogleExecutionRequest(createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: VISION_ROUTES[1].modelId,
    content,
  }));
  assert.equal(googleBody.contents[0].parts[1].inlineData.mimeType, 'image/webp');
});

test('D04 rejects a single image above the 20 MB neutral safety limit before provider traffic', () => {
  const oversized = pngBase64(MAX_VISION_IMAGE_BYTES + 1);
  assert.throws(
    () => createImageContentPart({ mimeType: 'image/png', data: oversized }),
    (error) => error?.code === AI_ERROR_CODES.BAD_REQUEST &&
      error?.details?.maxBytes === MAX_VISION_IMAGE_BYTES
  );
});

test('D04 teacher voice resolution is system-owned and ignores per-call profile selection', async () => {
  const env = { AI_TEACHER_VOICE_ID: 'KIWI_TEACHER_EN_PRIMARY' };
  const resolved = resolveTeacherVoice('KIWI_TEACHER_EN_ALT', env);
  assert.equal(resolved.id, 'KIWI_TEACHER_EN_PRIMARY');
  assert.equal(resolved.systemOwned, true);
  assert.equal(resolved.immutable, true);

  let usedProfile = null;
  const runtime = createMediaCapabilityRuntime({
    env,
    groqAdapter: {
      async generate() {
        throw new Error('vision not used in this test');
      },
      async synthesizeSpeech({ voiceProfile }) {
        usedProfile = voiceProfile;
        return {
          audioBuffer: Buffer.from('RIFF0000WAVE', 'ascii'),
          mimeType: 'audio/wav',
          latencyMs: 1,
        };
      },
    },
    googleAdapter: {
      async generate() {
        throw new Error('vision not used in this test');
      },
    },
    groqCredentialPool: {
      orderedSlots() { return [{ id: 'groq-test-01', apiKey: 'not-a-real-secret' }]; },
      disable() { return true; },
    },
    projectPool: {
      orderedSlots() { return [{ id: 'google-test-01', apiKey: 'not-a-real-secret' }]; },
      disable() { return true; },
    },
    logger: { warn() {}, info() {}, log() {} },
  });

  const response = await runtime.synthesizeTeacherVoice({
    transcript: 'The teacher identity must remain consistent.',
    voiceId: 'KIWI_TEACHER_EN_ALT',
  });

  assert.equal(usedProfile.id, 'KIWI_TEACHER_EN_PRIMARY');
  assert.equal(usedProfile.providerVoice, TEACHER_VOICE_PROFILES.KIWI_TEACHER_EN_PRIMARY.providerVoice);
  assert.equal(response.voiceId, 'KIWI_TEACHER_EN_PRIMARY');
});

test('D04 media validation failure cannot alter ordinary text request serialization', () => {
  assert.throws(
    () => createImageContentPart({
      mimeType: 'image/webp',
      data: Buffer.from('not-webp').toString('base64'),
    }),
    (error) => error?.code === AI_ERROR_CODES.BAD_REQUEST
  );

  const textRequest = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: 'openai/gpt-oss-20b',
    taskId: 'CARD_EXPLANATION',
    content: 'Explain conservation of momentum.',
    generation: {
      reasoning: { requested: 'LOW', resolved: 'LOW' },
    },
  });
  const body = serializeGroqExecutionRequest(textRequest);

  assert.equal(body.messages[0].content, 'Explain conservation of momentum.');
  assert.equal(Array.isArray(body.messages[0].content), false);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.include_reasoning, false);
});
