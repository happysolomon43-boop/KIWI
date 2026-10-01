'use strict';

const { AI_PROVIDERS } = require('./providers');
const { MODEL_IDS } = require('./model-catalog');

const TEACHER_VOICE_PROFILES = Object.freeze({
  KIWI_TEACHER_EN_PRIMARY: Object.freeze({
    id: 'KIWI_TEACHER_EN_PRIMARY',
    provider: AI_PROVIDERS.GROQ,
    modelId: MODEL_IDS.ORPHEUS_ENGLISH,
    providerVoice: 'hannah',
    language: 'en',
    responseFormat: 'wav',
  }),
  KIWI_TEACHER_EN_ALT: Object.freeze({
    id: 'KIWI_TEACHER_EN_ALT',
    provider: AI_PROVIDERS.GROQ,
    modelId: MODEL_IDS.ORPHEUS_ENGLISH,
    providerVoice: 'daniel',
    language: 'en',
    responseFormat: 'wav',
  }),
  KIWI_TEACHER_AR_SA_PRIMARY: Object.freeze({
    id: 'KIWI_TEACHER_AR_SA_PRIMARY',
    provider: AI_PROVIDERS.GROQ,
    modelId: MODEL_IDS.ORPHEUS_ARABIC_SAUDI,
    providerVoice: 'noura',
    language: 'ar-SA',
    responseFormat: 'wav',
  }),
});

function configuredTeacherVoiceId(env = process.env) {
  return String(env?.AI_TEACHER_VOICE_ID || 'KIWI_TEACHER_EN_PRIMARY').trim();
}

function resolveTeacherVoice(env = process.env) {
  return TEACHER_VOICE_PROFILES[configuredTeacherVoiceId(env)] || null;
}

module.exports = {
  TEACHER_VOICE_PROFILES,
  configuredTeacherVoiceId,
  resolveTeacherVoice,
};
