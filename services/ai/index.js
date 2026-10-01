'use strict';

const { createAIOrchestrator } = require('./orchestrator');
const {
  createModelCatalog,
  createQualificationModelCatalog,
  GROQ_QUALIFICATION_MODEL_CATALOG,
  GROQ_MODEL_IDS,
  GROQ_TEXT_CAPABILITIES,
} = require('./model-catalog');
const { createModelRouter } = require('./model-router');
const {
  createProjectPool,
  createGroqCredentialPool,
  createCloudflareCredentialPool,
} = require('./project-pool');
const { createGeminiTransport } = require('./gemini-transport');
const { createGoogleProviderAdapter } = require('./google-provider-adapter');
const { createGroqHttpTransport } = require('./groq-http-transport');
const { createGroqSpeechTransport } = require('./groq-speech-transport');
const {
  createGroqProviderAdapter,
  GROQ_QUOTA_POLICY,
  GROQ_SUPPORTED_REASONING,
  serializeGroqSpeechRequest,
} = require('./groq-provider-adapter');
const { normalizeGroqResponse } = require('./groq-response-normalizer');
const {
  GROQ_ERROR_CODES,
  classifyGroqHttpError,
  extractGroqEvidence,
} = require('./groq-error-classifier');
const {
  createIsolatedProviderExecutor,
  createGroqIsolatedExecutor,
} = require('./isolated-provider-executor');
const { createProviderRegistry } = require('./provider-registry');
const { AI_PROVIDERS } = require('./providers');
const {
  AI_CONTENT_KINDS,
  AI_CONTENT_PART_KINDS,
  AI_MEDIA_CAPABILITIES,
  AI_AUDIO_ENCODINGS,
  SUPPORTED_IMAGE_MIME_TYPES,
  MAX_VISION_IMAGES,
  MAX_VISION_IMAGE_BYTES,
  MAX_VISION_TOTAL_BYTES,
  MAX_SPEECH_CHUNK_CHARACTERS,
  MAX_SPEECH_TRANSCRIPT_CHARACTERS,
  createTextContentPart,
  createImageContentPart,
  createMultimodalContent,
  createExecutionRequest,
  createExecutionResponse,
  createSpeechSynthesisRequest,
  splitSpeechTranscript,
  createAudioSegment,
  createSpeechSynthesisResponse,
} = require('./execution-contracts');
const {
  MEDIA_MODEL_STATUS,
  VISION_ROUTES,
  ORPHEUS_MODELS,
  TEACHER_VOICE_PROFILES,
  resolveTeacherVoice,
} = require('./media-model-catalog');
const { createMediaTelemetry } = require('./media-telemetry');
const {
  DEFAULT_VISION_TIMEOUT_MS,
  DEFAULT_SPEECH_TIMEOUT_MS,
  createMediaCapabilityRuntime,
} = require('./media-capability-runtime');
const { createDefaultMediaCapabilityRuntime } = require('./media-capability-factory');
const {
  QUOTA_SCOPES,
  getProviderQuotaPolicy,
  credentialFailureAction,
  quotaScopeFromError,
} = require('./quota-policy');
const { normalizeGeminiResponse } = require('./response-normalizer');
const { createQuotaManager } = require('./quota-manager');
const { createTelemetry } = require('./telemetry');
const { createPostgresAIStore } = require('./postgres-store');
const { createModelLifecycle } = require('./model-lifecycle');
const { createModelQualifier } = require('./model-qualifier');
const { createModelDiscoveryManager } = require('./model-discovery');
const { createProviderHealth } = require('./provider-health');
const { createAITrafficController } = require('./traffic-controller');
const { createAIRuntime } = require('./runtime');

module.exports = {
  createAIOrchestrator,
  createModelCatalog,
  createQualificationModelCatalog,
  GROQ_QUALIFICATION_MODEL_CATALOG,
  GROQ_MODEL_IDS,
  GROQ_TEXT_CAPABILITIES,
  createModelRouter,
  createProjectPool,
  createGroqCredentialPool,
  createCloudflareCredentialPool,
  createGeminiTransport,
  createGoogleProviderAdapter,
  createGroqHttpTransport,
  createGroqSpeechTransport,
  createGroqProviderAdapter,
  GROQ_QUOTA_POLICY,
  GROQ_SUPPORTED_REASONING,
  serializeGroqSpeechRequest,
  normalizeGroqResponse,
  GROQ_ERROR_CODES,
  classifyGroqHttpError,
  extractGroqEvidence,
  createIsolatedProviderExecutor,
  createGroqIsolatedExecutor,
  createProviderRegistry,
  AI_PROVIDERS,
  AI_CONTENT_KINDS,
  AI_CONTENT_PART_KINDS,
  AI_MEDIA_CAPABILITIES,
  AI_AUDIO_ENCODINGS,
  SUPPORTED_IMAGE_MIME_TYPES,
  MAX_VISION_IMAGES,
  MAX_VISION_IMAGE_BYTES,
  MAX_VISION_TOTAL_BYTES,
  MAX_SPEECH_CHUNK_CHARACTERS,
  MAX_SPEECH_TRANSCRIPT_CHARACTERS,
  createTextContentPart,
  createImageContentPart,
  createMultimodalContent,
  createExecutionRequest,
  createExecutionResponse,
  createSpeechSynthesisRequest,
  splitSpeechTranscript,
  createAudioSegment,
  createSpeechSynthesisResponse,
  MEDIA_MODEL_STATUS,
  VISION_ROUTES,
  ORPHEUS_MODELS,
  TEACHER_VOICE_PROFILES,
  resolveTeacherVoice,
  createMediaTelemetry,
  DEFAULT_VISION_TIMEOUT_MS,
  DEFAULT_SPEECH_TIMEOUT_MS,
  createMediaCapabilityRuntime,
  createDefaultMediaCapabilityRuntime,
  QUOTA_SCOPES,
  getProviderQuotaPolicy,
  credentialFailureAction,
  quotaScopeFromError,
  normalizeGeminiResponse,
  createQuotaManager,
  createTelemetry,
  createPostgresAIStore,
  createModelLifecycle,
  createModelQualifier,
  createModelDiscoveryManager,
  createProviderHealth,
  createAITrafficController,
  createAIRuntime,
};
