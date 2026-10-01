'use strict';

const { AI_PROVIDERS } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');
const {
  AI_MEDIA_CAPABILITIES,
  createMultimodalContent,
  createExecutionRequest,
  createSpeechSynthesisRequest,
  createSpeechSynthesisResponse,
  createAudioSegment,
  splitSpeechTranscript,
} = require('./execution-contracts');
const {
  VISION_ROUTES,
  resolveTeacherVoice,
} = require('./media-model-catalog');
const { createMediaTelemetry } = require('./media-telemetry');
const { normalizeGeminiResponse } = require('./response-normalizer');

const DEFAULT_VISION_TIMEOUT_MS = 19000;
const DEFAULT_SPEECH_TIMEOUT_MS = 15000;

const VISION_PROVIDER_MODES = Object.freeze({
  QWEN_FIRST: 'QWEN_FIRST',
  GOOGLE_ONLY: 'GOOGLE_ONLY',
});

const TEACHER_VOICE_MODES = Object.freeze({
  ORPHEUS: 'ORPHEUS',
  DISABLED: 'DISABLED',
});

const VOICE_DISABLED_CODE = 'VOICE_DISABLED';

function _boundedTimeout(value, fallback, min = 1000, max = 60000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function _enumMode(value, allowed, fallback) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(allowed).includes(normalized) ? normalized : fallback;
}

function _routeKey(route) {
  return `${route.provider}::${route.modelId}`;
}

function _isCredentialFailure(error) {
  return error?.code === AI_ERROR_CODES.AUTH ||
    error?.code === AI_ERROR_CODES.PERMISSION;
}

function _isTerminalVisionFailure(error, signal) {
  return Boolean(
    signal?.aborted ||
    error?.code === AI_ERROR_CODES.CANCELLED ||
    error?.code === AI_ERROR_CODES.BAD_REQUEST ||
    error?.code === AI_ERROR_CODES.SAFETY
  );
}

function _providerFailure(error, provider) {
  if (error instanceof AIError) return error;
  return new AIError('Media capability provider request failed', {
    code: AI_ERROR_CODES.UNKNOWN,
    retryable: true,
    scope: 'ATTEMPT',
    provider,
    cause: error,
  });
}

function _teacherLanguageFamily(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'ar' || normalized.startsWith('ar-')) return 'ar';
  return null;
}

function _assertVisionOutput(response, provider) {
  if (response?.blocked) return response;
  if (String(response?.text || '').trim()) return response;
  if (response?.structuredData != null) return response;
  throw new AIError('Vision provider returned no usable output', {
    code: AI_ERROR_CODES.EMPTY_RESPONSE,
    retryable: true,
    scope: 'ATTEMPT',
    provider,
  });
}

function createMediaCapabilityRuntime({
  env = process.env,
  groqAdapter,
  googleAdapter,
  groqCredentialPool,
  projectPool,
  telemetry = null,
  logger = console,
} = {}) {
  if (!groqAdapter?.generate || !groqAdapter?.synthesizeSpeech) {
    throw new Error('Media capability runtime requires Groq vision and speech adapter support');
  }
  if (!googleAdapter?.generate) {
    throw new Error('Media capability runtime requires Google vision fallback adapter');
  }
  if (!groqCredentialPool?.orderedSlots || !projectPool?.orderedSlots) {
    throw new Error('Media capability runtime requires provider credential pools');
  }

  const mediaTelemetry = telemetry || createMediaTelemetry({ logger });
  const visionTimeoutMs = _boundedTimeout(
    env.AI_VISION_ATTEMPT_TIMEOUT_MS,
    DEFAULT_VISION_TIMEOUT_MS
  );
  const speechTimeoutMs = _boundedTimeout(
    env.AI_SPEECH_ATTEMPT_TIMEOUT_MS,
    DEFAULT_SPEECH_TIMEOUT_MS
  );
  const visionProviderMode = _enumMode(
    env.AI_VISION_PROVIDER_MODE,
    VISION_PROVIDER_MODES,
    VISION_PROVIDER_MODES.QWEN_FIRST
  );
  const teacherVoiceMode = _enumMode(
    env.AI_TEACHER_VOICE_MODE,
    TEACHER_VOICE_MODES,
    TEACHER_VOICE_MODES.ORPHEUS
  );
  const activeVisionRoutes = Object.freeze(
    visionProviderMode === VISION_PROVIDER_MODES.GOOGLE_ONLY
      ? VISION_ROUTES.filter((route) => route.provider === AI_PROVIDERS.GOOGLE)
      : [...VISION_ROUTES]
  );

  async function _executeGroqVision({
    route,
    content,
    generation,
    taskId,
    metadata,
    signal,
    fallbackDepth,
  }) {
    const request = createExecutionRequest({
      provider: route.provider,
      modelId: route.modelId,
      taskId,
      content,
      generation,
      metadata: {
        ...(metadata || {}),
        capability: AI_MEDIA_CAPABILITIES.VISION,
        delivery: 'AIM_D04',
      },
    });
    const slots = groqCredentialPool.orderedSlots(_routeKey(route));
    if (slots.length === 0) {
      throw new AIError('No Groq credential is available for vision', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: true,
        scope: 'PROVIDER',
        provider: AI_PROVIDERS.GROQ,
      });
    }

    let lastError = null;
    for (const credential of slots) {
      const startedAt = Date.now();
      try {
        const result = await groqAdapter.generate({
          credential,
          request,
          timeoutMs: visionTimeoutMs,
          signal,
          fallbackDepth,
        });
        const response = _assertVisionOutput(result.normalized, AI_PROVIDERS.GROQ);
        mediaTelemetry.record({
          capability: AI_MEDIA_CAPABILITIES.VISION,
          outcome: 'SUCCESS',
          provider: route.provider,
          modelId: route.modelId,
          credentialSlot: credential.id,
          fallbackDepth,
          latencyMs: result.latencyMs ?? (Date.now() - startedAt),
          imageCount: content.media.imageCount,
          totalImageBytes: content.media.totalImageBytes,
          imageMimeTypes: content.media.imageMimeTypes,
        });
        return response;
      } catch (error) {
        lastError = _providerFailure(error, AI_PROVIDERS.GROQ);
        mediaTelemetry.record({
          capability: AI_MEDIA_CAPABILITIES.VISION,
          outcome: 'FAILED',
          provider: route.provider,
          modelId: route.modelId,
          credentialSlot: credential.id,
          fallbackDepth,
          latencyMs: Date.now() - startedAt,
          errorCode: lastError.code,
          imageCount: content.media.imageCount,
          totalImageBytes: content.media.totalImageBytes,
          imageMimeTypes: content.media.imageMimeTypes,
        });
        if (_isCredentialFailure(lastError)) {
          groqCredentialPool.disable?.(credential.id, lastError.code);
          continue;
        }
        break;
      }
    }
    throw lastError || new AIError('Groq vision failed', {
      code: AI_ERROR_CODES.UNKNOWN,
      retryable: true,
      provider: AI_PROVIDERS.GROQ,
    });
  }

  async function _executeGoogleVision({
    route,
    content,
    generation,
    taskId,
    metadata,
    signal,
    fallbackDepth,
  }) {
    const request = createExecutionRequest({
      provider: route.provider,
      modelId: route.modelId,
      taskId,
      content,
      generation,
      metadata: {
        ...(metadata || {}),
        capability: AI_MEDIA_CAPABILITIES.VISION,
        delivery: 'AIM_D04',
      },
    });
    const slots = projectPool.orderedSlots(_routeKey(route));
    if (slots.length === 0) {
      throw new AIError('No Google credential is available for vision fallback', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: true,
        scope: 'PROVIDER',
        provider: AI_PROVIDERS.GOOGLE,
      });
    }

    let lastError = null;
    for (const credential of slots) {
      const startedAt = Date.now();
      try {
        const result = await googleAdapter.generate({
          credential,
          request,
          timeoutMs: visionTimeoutMs,
          signal,
        });
        const response = _assertVisionOutput(normalizeGeminiResponse(result.raw, {
          modelId: route.modelId,
          slotId: credential.id,
          latencyMs: result.latencyMs,
          fallbackDepth,
        }), AI_PROVIDERS.GOOGLE);
        mediaTelemetry.record({
          capability: AI_MEDIA_CAPABILITIES.VISION,
          outcome: 'SUCCESS',
          provider: route.provider,
          modelId: route.modelId,
          credentialSlot: credential.id,
          fallbackDepth,
          latencyMs: result.latencyMs ?? (Date.now() - startedAt),
          imageCount: content.media.imageCount,
          totalImageBytes: content.media.totalImageBytes,
          imageMimeTypes: content.media.imageMimeTypes,
        });
        return response;
      } catch (error) {
        lastError = _providerFailure(error, AI_PROVIDERS.GOOGLE);
        mediaTelemetry.record({
          capability: AI_MEDIA_CAPABILITIES.VISION,
          outcome: 'FAILED',
          provider: route.provider,
          modelId: route.modelId,
          credentialSlot: credential.id,
          fallbackDepth,
          latencyMs: Date.now() - startedAt,
          errorCode: lastError.code,
          imageCount: content.media.imageCount,
          totalImageBytes: content.media.totalImageBytes,
          imageMimeTypes: content.media.imageMimeTypes,
        });
        if (_isCredentialFailure(lastError)) {
          projectPool.disable?.(credential.id, lastError.code);
          continue;
        }
        break;
      }
    }
    throw lastError || new AIError('Google vision fallback failed', {
      code: AI_ERROR_CODES.UNKNOWN,
      retryable: true,
      provider: AI_PROVIDERS.GOOGLE,
    });
  }

  async function analyzeVision({
    parts,
    generation = {},
    taskId = 'VISION_ANALYSIS',
    metadata = {},
    signal = null,
  } = {}) {
    const content = createMultimodalContent(parts);
    let primaryError = null;

    for (let index = 0; index < activeVisionRoutes.length; index++) {
      const route = activeVisionRoutes[index];
      try {
        if (route.provider === AI_PROVIDERS.GROQ) {
          return await _executeGroqVision({
            route,
            content,
            generation,
            taskId,
            metadata,
            signal,
            fallbackDepth: index,
          });
        }
        if (route.provider === AI_PROVIDERS.GOOGLE) {
          return await _executeGoogleVision({
            route,
            content,
            generation,
            taskId,
            metadata,
            signal,
            fallbackDepth: index,
          });
        }
      } catch (error) {
        if (!primaryError) primaryError = error;
        if (_isTerminalVisionFailure(error, signal)) throw error;
      }
    }

    throw new AIError('All qualified KIWI vision routes failed', {
      code: AI_ERROR_CODES.CAPACITY_EXHAUSTED,
      status: 503,
      retryable: true,
      scope: 'CAPABILITY',
      details: {
        primaryErrorCode: primaryError?.code || AI_ERROR_CODES.UNKNOWN,
      },
    });
  }

  async function synthesizeTeacherVoice({
    transcript,
    voiceId = null,
    language = 'en',
    metadata = {},
    signal = null,
  } = {}) {
    // Teacher voice identity is deployment/course-owned. Per-call voiceId is
    // intentionally ignored so a feature cannot silently change the teacher.
    void voiceId;
    const profile = resolveTeacherVoice(null, env);
    if (!profile) {
      throw new AIError('KIWI teacher voice configuration is invalid', {
        code: AI_ERROR_CODES.CONFIG,
        retryable: false,
        scope: 'CAPABILITY',
      });
    }

    const requestedLanguageFamily = _teacherLanguageFamily(language);
    const profileLanguageFamily = _teacherLanguageFamily(profile.language);
    if (!requestedLanguageFamily || requestedLanguageFamily !== profileLanguageFamily) {
      throw new AIError('Requested speech language does not match the configured KIWI teacher voice', {
        code: AI_ERROR_CODES.BAD_REQUEST,
        retryable: false,
        scope: 'REQUEST',
        details: {
          requestedLanguage: String(language || ''),
          configuredVoiceLanguage: profile.language,
          configuredVoiceId: profile.id,
        },
      });
    }

    const request = createSpeechSynthesisRequest({
      transcript,
      voiceId: profile.id,
      language: profile.language,
      metadata,
    });

    const chunks = splitSpeechTranscript(request.transcript);
    if (teacherVoiceMode === TEACHER_VOICE_MODES.DISABLED) {
      mediaTelemetry.record({
        capability: AI_MEDIA_CAPABILITIES.SPEECH_SYNTHESIS,
        outcome: 'DEGRADED',
        provider: profile.provider,
        modelId: profile.modelId,
        voiceId: profile.id,
        speechChunkCount: chunks.length,
        degraded: true,
        errorCode: VOICE_DISABLED_CODE,
      });
      return createSpeechSynthesisResponse({
        transcript: request.transcript,
        voiceId: profile.id,
        provider: profile.provider,
        modelId: profile.modelId,
        segments: [],
        degraded: true,
        failure: {
          code: VOICE_DISABLED_CODE,
          provider: profile.provider,
          retryable: false,
        },
      });
    }

    const slots = groqCredentialPool.orderedSlots(`${AI_PROVIDERS.GROQ}::${profile.modelId}`);
    if (slots.length === 0) {
      mediaTelemetry.record({
        capability: AI_MEDIA_CAPABILITIES.SPEECH_SYNTHESIS,
        outcome: 'DEGRADED',
        provider: profile.provider,
        modelId: profile.modelId,
        voiceId: profile.id,
        speechChunkCount: chunks.length,
        degraded: true,
        errorCode: AI_ERROR_CODES.CONFIG,
      });
      return createSpeechSynthesisResponse({
        transcript: request.transcript,
        voiceId: profile.id,
        provider: profile.provider,
        modelId: profile.modelId,
        segments: [],
        degraded: true,
        failure: {
          code: AI_ERROR_CODES.CONFIG,
          provider: profile.provider,
          retryable: true,
        },
      });
    }

    let lastError = null;
    for (const credential of slots) {
      const segments = [];
      const startedAt = Date.now();
      try {
        for (let index = 0; index < chunks.length; index++) {
          const result = await groqAdapter.synthesizeSpeech({
            credential,
            request,
            voiceProfile: profile,
            input: chunks[index],
            timeoutMs: speechTimeoutMs,
            signal,
          });
          segments.push(createAudioSegment({
            data: result.audioBuffer.toString('base64'),
            mimeType: result.mimeType,
            byteLength: result.audioBuffer.length,
            index,
          }));
        }

        const latencyMs = Date.now() - startedAt;
        mediaTelemetry.record({
          capability: AI_MEDIA_CAPABILITIES.SPEECH_SYNTHESIS,
          outcome: 'SUCCESS',
          provider: profile.provider,
          modelId: profile.modelId,
          credentialSlot: credential.id,
          latencyMs,
          voiceId: profile.id,
          speechChunkCount: chunks.length,
          audioBytes: segments.reduce((sum, segment) => sum + segment.byteLength, 0),
        });
        return createSpeechSynthesisResponse({
          transcript: request.transcript,
          voiceId: profile.id,
          provider: profile.provider,
          modelId: profile.modelId,
          segments,
          latencyMs,
          degraded: false,
          credentialSlot: credential.id,
        });
      } catch (error) {
        lastError = _providerFailure(error, AI_PROVIDERS.GROQ);
        if (lastError.code === AI_ERROR_CODES.CANCELLED || signal?.aborted) throw lastError;
        if (_isCredentialFailure(lastError)) {
          groqCredentialPool.disable?.(credential.id, lastError.code);
          continue;
        }
        break;
      }
    }

    mediaTelemetry.record({
      capability: AI_MEDIA_CAPABILITIES.SPEECH_SYNTHESIS,
      outcome: 'DEGRADED',
      provider: profile.provider,
      modelId: profile.modelId,
      voiceId: profile.id,
      speechChunkCount: chunks.length,
      degraded: true,
      errorCode: lastError?.code || AI_ERROR_CODES.UNKNOWN,
    });
    return createSpeechSynthesisResponse({
      transcript: request.transcript,
      voiceId: profile.id,
      provider: profile.provider,
      modelId: profile.modelId,
      segments: [],
      degraded: true,
      failure: {
        code: lastError?.code || AI_ERROR_CODES.UNKNOWN,
        provider: profile.provider,
        retryable: Boolean(lastError?.retryable),
      },
    });
  }

  function status() {
    return Object.freeze({
      vision: Object.freeze({
        mode: visionProviderMode,
        timeoutMs: visionTimeoutMs,
        routes: Object.freeze(activeVisionRoutes.map((route) => Object.freeze({
          provider: route.provider,
          modelId: route.modelId,
          role: route.role,
          status: route.status,
        }))),
      }),
      speech: Object.freeze({
        mode: teacherVoiceMode,
        timeoutMs: speechTimeoutMs,
        defaultVoiceId: String(env.AI_TEACHER_VOICE_ID || 'KIWI_TEACHER_EN_PRIMARY'),
      }),
      telemetry: mediaTelemetry.snapshot(),
    });
  }

  return Object.freeze({
    analyzeVision,
    synthesizeTeacherVoice,
    status,
    telemetry: mediaTelemetry,
  });
}

module.exports = {
  DEFAULT_VISION_TIMEOUT_MS,
  DEFAULT_SPEECH_TIMEOUT_MS,
  VISION_PROVIDER_MODES,
  TEACHER_VOICE_MODES,
  VOICE_DISABLED_CODE,
  createMediaCapabilityRuntime,
};
