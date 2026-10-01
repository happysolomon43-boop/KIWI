'use strict';

const { AI_PROVIDERS } = require('./providers');
const {
  GOOGLE_MODEL_IDS,
  GROQ_MODEL_IDS,
  GROQ_SPEECH_MODEL_IDS,
} = require('./model-catalog');
const { AI_MEDIA_CAPABILITIES } = require('./execution-contracts');

const MEDIA_MODEL_STATUS = Object.freeze({
  APPROVED_EXISTING: 'APPROVED_EXISTING',
  PREVIEW_CAPABILITY: 'PREVIEW_CAPABILITY',
});

const VISION_ROUTES = Object.freeze([
  Object.freeze({
    capability: AI_MEDIA_CAPABILITIES.VISION,
    provider: AI_PROVIDERS.GROQ,
    modelId: GROQ_MODEL_IDS.QWEN_3_8_27B,
    status: MEDIA_MODEL_STATUS.PREVIEW_CAPABILITY,
    role: 'PRIMARY',
    maxImages: 3,
    maxImageBytes: 20 * 1024 * 1024,
    supportedMimeTypes: Object.freeze(['image/jpeg', 'image/png']),
    supportedReasoning: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    structuredOutput: true,
    metadata: Object.freeze({
      delivery: 'AIM_D04',
      providerReleaseStatus: 'PREVIEW',
      isolatedFromTextRouting: true,
    }),
  }),
  Object.freeze({
    capability: AI_MEDIA_CAPABILITIES.VISION,
    provider: AI_PROVIDERS.GOOGLE,
    modelId: GOOGLE_MODEL_IDS.GEMINI_3_8_FLASH,
    status: MEDIA_MODEL_STATUS.APPROVED_EXISTING,
    role: 'FALLBACK',
    maxImages: 3,
    maxImageBytes: 20 * 1024 * 1024,
    supportedMimeTypes: Object.freeze(['image/jpeg', 'image/png']),
    supportedReasoning: Object.freeze(['LOW', 'MEDIUM', 'HIGH']),
    structuredOutput: true,
    metadata: Object.freeze({
      delivery: 'AIM_D04',
      fallbackQualification: 'EXISTING_APPROVED_GEMINI_VISION',
      isolatedFromTextRouting: true,
    }),
  }),
]);

const ORPHEUS_MODELS = Object.freeze({
  ENGLISH: GROQ_SPEECH_MODEL_IDS.ORPHEUS_ENGLISH,
  ARABIC_SAUDI: GROQ_SPEECH_MODEL_IDS.ORPHEUS_ARABIC_SAUDI,
});

const TEACHER_VOICE_PROFILES = Object.freeze({
  KIWI_TEACHER_EN_PRIMARY: Object.freeze({
    id: 'KIWI_TEACHER_EN_PRIMARY',
    provider: AI_PROVIDERS.GROQ,
    modelId: ORPHEUS_MODELS.ENGLISH,
    providerVoice: 'hannah',
    language: 'en',
    responseFormat: 'wav',
  }),
  KIWI_TEACHER_EN_ALT: Object.freeze({
    id: 'KIWI_TEACHER_EN_ALT',
    provider: AI_PROVIDERS.GROQ,
    modelId: ORPHEUS_MODELS.ENGLISH,
    providerVoice: 'daniel',
    language: 'en',
    responseFormat: 'wav',
  }),
  KIWI_TEACHER_AR_SA_PRIMARY: Object.freeze({
    id: 'KIWI_TEACHER_AR_SA_PRIMARY',
    provider: AI_PROVIDERS.GROQ,
    modelId: ORPHEUS_MODELS.ARABIC_SAUDI,
    providerVoice: 'noura',
    language: 'ar-SA',
    responseFormat: 'wav',
  }),
});

function resolveTeacherVoice(voiceId, env = process.env) {
  const requested = String(
    voiceId ||
    env?.AI_TEACHER_VOICE_ID ||
    'KIWI_TEACHER_EN_PRIMARY'
  ).trim();
  return TEACHER_VOICE_PROFILES[requested] || null;
}

module.exports = {
  MEDIA_MODEL_STATUS,
  VISION_ROUTES,
  ORPHEUS_MODELS,
  TEACHER_VOICE_PROFILES,
  resolveTeacherVoice,
};
