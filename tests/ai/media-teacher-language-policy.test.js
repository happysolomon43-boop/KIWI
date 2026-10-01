'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_ERROR_CODES } = require('../../services/ai/errors');
const { GROQ_SPEECH_MODEL_IDS } = require('../../services/ai/model-catalog');
const { createMediaCapabilityRuntime } = require('../../services/ai/media-capability-runtime');

function createRuntime(env, onSpeech) {
  return createMediaCapabilityRuntime({
    env,
    groqAdapter: {
      async generate() {
        throw new Error('vision not used in teacher-language policy test');
      },
      async synthesizeSpeech(args) {
        onSpeech?.(args);
        return {
          audioBuffer: Buffer.from('RIFF0000WAVE', 'ascii'),
          mimeType: 'audio/wav',
          latencyMs: 1,
        };
      },
    },
    googleAdapter: {
      async generate() {
        throw new Error('vision not used in teacher-language policy test');
      },
    },
    groqCredentialPool: {
      orderedSlots() {
        return [{ id: 'groq-test-01', apiKey: 'test-only' }];
      },
      disable() { return true; },
    },
    projectPool: {
      orderedSlots() {
        return [{ id: 'google-test-01', apiKey: 'test-only' }];
      },
      disable() { return true; },
    },
    logger: { warn() {}, info() {}, log() {} },
  });
}

test('D04 configured Arabic teacher identity uses the Arabic Orpheus model and voice', async () => {
  let call = null;
  const runtime = createRuntime({
    AI_TEACHER_VOICE_ID: 'KIWI_TEACHER_AR_SA_PRIMARY',
  }, (args) => { call = args; });

  const transcript = 'مرحبا بك في الدرس';
  const response = await runtime.synthesizeTeacherVoice({
    transcript,
    language: 'ar-SA',
  });

  assert.ok(call);
  assert.equal(call.voiceProfile.id, 'KIWI_TEACHER_AR_SA_PRIMARY');
  assert.equal(call.voiceProfile.providerVoice, 'noura');
  assert.equal(call.voiceProfile.modelId, GROQ_SPEECH_MODEL_IDS.ORPHEUS_ARABIC_SAUDI);
  assert.equal(call.request.voiceId, 'KIWI_TEACHER_AR_SA_PRIMARY');
  assert.equal(call.request.language, 'ar-SA');
  assert.equal(response.voiceId, 'KIWI_TEACHER_AR_SA_PRIMARY');
  assert.equal(response.transcript, transcript);
  assert.equal(response.degraded, false);
});

test('D04 rejects language mismatch before provider traffic and ignores per-call voice overrides', async () => {
  let speechCalls = 0;
  const runtime = createRuntime({
    AI_TEACHER_VOICE_ID: 'KIWI_TEACHER_EN_PRIMARY',
  }, () => { speechCalls += 1; });

  await assert.rejects(
    () => runtime.synthesizeTeacherVoice({
      transcript: 'هذا الطلب لا يجب أن يستخدم صوت المعلم الإنجليزي',
      language: 'ar-SA',
      voiceId: 'KIWI_TEACHER_AR_SA_PRIMARY',
    }),
    (error) => error?.code === AI_ERROR_CODES.BAD_REQUEST &&
      error?.details?.configuredVoiceId === 'KIWI_TEACHER_EN_PRIMARY'
  );

  assert.equal(speechCalls, 0);
});
