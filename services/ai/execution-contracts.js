'use strict';

const { createProviderModelRef } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');

const AI_CONTENT_KINDS = Object.freeze({
  TEXT: 'TEXT',
  MULTIMODAL: 'MULTIMODAL',
  LEGACY_PROVIDER_CONTENT: 'LEGACY_PROVIDER_CONTENT',
});

const AI_CONTENT_PART_KINDS = Object.freeze({
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
});

const AI_MEDIA_CAPABILITIES = Object.freeze({
  VISION: 'VISION',
  SPEECH_SYNTHESIS: 'SPEECH_SYNTHESIS',
});

const AI_AUDIO_ENCODINGS = Object.freeze({
  BASE64: 'BASE64',
});

const SUPPORTED_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_VISION_IMAGES = 3;
const MAX_VISION_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VISION_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SPEECH_CHUNK_CHARACTERS = 200;
const MAX_SPEECH_TRANSCRIPT_CHARACTERS = 2000;

function _cloneJsonCompatible(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) {}
  }
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function _badRequest(message, details = null) {
  return new AIError(message, {
    code: AI_ERROR_CODES.BAD_REQUEST,
    retryable: false,
    scope: 'REQUEST',
    details,
  });
}

function _normalizedBase64(value) {
  const data = String(value || '').replace(/\s+/g, '');
  if (!data) throw _badRequest('Image data must contain base64 content');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw _badRequest('Image data must be valid padded base64');
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length) throw _badRequest('Image data decoded to an empty payload');
  const canonical = bytes.toString('base64');
  if (canonical !== data) {
    throw _badRequest('Image data is not canonical base64');
  }
  return { data, bytes: bytes.length };
}

function createTextContentPart(text) {
  const value = String(text ?? '');
  if (!value.trim()) throw _badRequest('Multimodal text part cannot be empty');
  return Object.freeze({
    kind: AI_CONTENT_PART_KINDS.TEXT,
    text: value,
  });
}

function createImageContentPart({
  mimeType,
  data,
  name = null,
} = {}) {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(normalizedMime)) {
    throw _badRequest('Unsupported image MIME type', {
      mimeType: normalizedMime || null,
      supportedMimeTypes: SUPPORTED_IMAGE_MIME_TYPES,
    });
  }

  const normalized = _normalizedBase64(data);
  const bytes = Buffer.from(normalized.data, 'base64');
  const signatureValid =
    (normalizedMime === 'image/png' &&
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (normalizedMime === 'image/jpeg' &&
      bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (normalizedMime === 'image/webp' &&
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!signatureValid) {
    throw _badRequest('Image bytes do not match the declared MIME type', {
      mimeType: normalizedMime,
    });
  }
  if (normalized.bytes > MAX_VISION_IMAGE_BYTES) {
    throw _badRequest('Image exceeds the KIWI vision size limit', {
      byteLength: normalized.bytes,
      maxBytes: MAX_VISION_IMAGE_BYTES,
    });
  }

  return Object.freeze({
    kind: AI_CONTENT_PART_KINDS.IMAGE,
    mimeType: normalizedMime,
    byteLength: normalized.bytes,
    name: name ? String(name).slice(0, 160) : null,
    source: Object.freeze({
      kind: 'BASE64',
      data: normalized.data,
    }),
  });
}

function _normalizeMultimodalPart(part) {
  if (!part || typeof part !== 'object') {
    throw _badRequest('Multimodal content part must be an object');
  }

  if (part.kind === AI_CONTENT_PART_KINDS.TEXT || part.type === 'text') {
    return createTextContentPart(part.text);
  }

  if (part.kind === AI_CONTENT_PART_KINDS.IMAGE || part.type === 'image') {
    const image = part.image || part;
    return createImageContentPart({
      mimeType: image.mimeType,
      data: image.source?.kind === 'BASE64'
        ? image.source.data
        : (image.data ?? image.dataBase64),
      name: image.name || null,
    });
  }

  throw _badRequest(`Unsupported multimodal content part ${part.kind || part.type || 'UNKNOWN'}`);
}

function createMultimodalContent(parts = []) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw _badRequest('Multimodal content requires at least one content part');
  }

  const normalized = parts.map(_normalizeMultimodalPart);

  const images = normalized.filter((part) => part.kind === AI_CONTENT_PART_KINDS.IMAGE);
  if (images.length === 0) {
    throw _badRequest('Vision content requires at least one image');
  }
  if (images.length > MAX_VISION_IMAGES) {
    throw _badRequest(`Vision content supports at most ${MAX_VISION_IMAGES} images`, {
      imageCount: images.length,
      maxImages: MAX_VISION_IMAGES,
    });
  }

  const totalImageBytes = images.reduce((sum, image) => sum + image.byteLength, 0);
  if (totalImageBytes > MAX_VISION_TOTAL_BYTES) {
    throw _badRequest('Combined image payload exceeds the KIWI vision size limit', {
      totalImageBytes,
      maxBytes: MAX_VISION_TOTAL_BYTES,
    });
  }

  return Object.freeze({
    kind: AI_CONTENT_KINDS.MULTIMODAL,
    parts: Object.freeze(normalized),
    media: Object.freeze({
      imageCount: images.length,
      imageMimeTypes: Object.freeze([...new Set(images.map((image) => image.mimeType))]),
      totalImageBytes,
    }),
  });
}

function normalizeExecutionContent(content, { legacyProvider = null } = {}) {
  if (typeof content === 'string' || content == null) {
    return Object.freeze({
      kind: AI_CONTENT_KINDS.TEXT,
      text: String(content ?? ''),
    });
  }

  if (content?.kind === AI_CONTENT_KINDS.MULTIMODAL) {
    return createMultimodalContent(content.parts);
  }

  return Object.freeze({
    kind: AI_CONTENT_KINDS.LEGACY_PROVIDER_CONTENT,
    provider: legacyProvider || null,
    value: _cloneJsonCompatible(content),
  });
}

function normalizeReasoningDirective(value = null) {
  if (!value) return null;
  const requested = String(value.requested || value.level || '').trim().toUpperCase() || null;
  const resolved = String(value.resolved || value.level || '').trim().toUpperCase() || null;
  if (!requested && !resolved) return null;
  return Object.freeze({ requested, resolved });
}

function normalizeStructuredOutputDirective(value = null) {
  if (!value || typeof value !== 'object') return null;
  const mimeType = String(value.mimeType || 'application/json').trim();
  const schema = value.schema == null ? null : _cloneJsonCompatible(value.schema);
  if (!mimeType && schema == null) return null;
  return Object.freeze({
    mimeType: mimeType || 'application/json',
    schema,
  });
}

function normalizeGenerationOptions(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const reasoning = normalizeReasoningDirective(source.reasoning || null);
  const structuredOutput = normalizeStructuredOutputDirective(source.structuredOutput || null);
  const normalized = {};

  for (const [key, value] of Object.entries(source)) {
    if (
      key === 'reasoning' ||
      key === 'structuredOutput' ||
      value === undefined
    ) continue;
    normalized[key] = _cloneJsonCompatible(value);
  }

  if (reasoning) normalized.reasoning = reasoning;
  if (structuredOutput) normalized.structuredOutput = structuredOutput;
  return Object.freeze(normalized);
}

function createExecutionRequest({
  provider,
  modelId,
  taskId = null,
  content = '',
  generation = {},
  metadata = {},
  legacyProviderContent = null,
} = {}) {
  const model = createProviderModelRef({ provider, modelId });
  const normalizedContent = content?.kind === AI_CONTENT_KINDS.MULTIMODAL
    ? createMultimodalContent(content.parts)
    : content?.kind
      ? Object.freeze({ ...content })
      : normalizeExecutionContent(content, {
          legacyProvider: legacyProviderContent || model.provider,
        });

  return Object.freeze({
    contractVersion: 1,
    provider: model.provider,
    model,
    taskId: taskId || null,
    content: normalizedContent,
    generation: normalizeGenerationOptions(generation),
    metadata: Object.freeze({ ...(metadata || {}) }),
  });
}

function createExecutionResponse({
  provider,
  requestedModel,
  providerModel = null,
  text = '',
  structuredData = null,
  finishReason = 'UNKNOWN',
  blocked = false,
  blockReason = null,
  usage = {},
  latencyMs = null,
  credentialSlot = null,
  fallbackDepth = 0,
  generationGroupId = null,
  providerMetadata = null,
} = {}) {
  const model = createProviderModelRef({ provider, modelId: requestedModel });
  const normalizedStructuredData = structuredData == null
    ? null
    : _cloneJsonCompatible(structuredData);
  const normalizedProviderMetadata = providerMetadata == null
    ? null
    : _cloneJsonCompatible(providerMetadata);

  return Object.freeze({
    contractVersion: 1,
    provider: model.provider,
    text: String(text ?? ''),
    structuredData: normalizedStructuredData == null
      ? null
      : Object.freeze(normalizedStructuredData),
    finishReason: finishReason || 'UNKNOWN',
    blocked: Boolean(blocked),
    blockReason: blockReason || null,
    providerModel: providerModel || requestedModel || null,
    requestedModel: requestedModel || null,
    model,
    projectSlot: credentialSlot || null,
    credentialSlot: credentialSlot || null,
    latencyMs,
    fallbackDepth: Number(fallbackDepth) || 0,
    generationGroupId: generationGroupId || null,
    providerMetadata: normalizedProviderMetadata == null
      ? null
      : Object.freeze(normalizedProviderMetadata),
    usage: Object.freeze({
      inputTokens: Number(usage.inputTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0,
      thoughtTokens: Number(usage.thoughtTokens) || 0,
      totalTokens: Number(usage.totalTokens) || 0,
      cachedContentTokens: Number(usage.cachedContentTokens) || 0,
    }),
  });
}

function createSpeechSynthesisRequest({
  transcript,
  voiceId = 'KIWI_TEACHER_EN_PRIMARY',
  language = 'en',
  metadata = {},
} = {}) {
  const text = String(transcript ?? '');
  if (!text.trim()) throw _badRequest('Speech synthesis requires a transcript');
  if (text.length > MAX_SPEECH_TRANSCRIPT_CHARACTERS) {
    throw _badRequest('Speech transcript exceeds the KIWI optional-voice limit', {
      characters: text.length,
      maxCharacters: MAX_SPEECH_TRANSCRIPT_CHARACTERS,
    });
  }
  return Object.freeze({
    contractVersion: 1,
    capability: AI_MEDIA_CAPABILITIES.SPEECH_SYNTHESIS,
    transcript: text,
    voiceId: String(voiceId || 'KIWI_TEACHER_EN_PRIMARY'),
    language: String(language || 'en'),
    responseFormat: 'wav',
    metadata: Object.freeze({ ...(metadata || {}) }),
  });
}

function splitSpeechTranscript(transcript, maxCharacters = MAX_SPEECH_CHUNK_CHARACTERS) {
  const text = String(transcript ?? '').trim();
  const limit = Math.max(1, Math.min(MAX_SPEECH_CHUNK_CHARACTERS, Number(maxCharacters) || MAX_SPEECH_CHUNK_CHARACTERS));
  if (!text) return [];
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = -1;
    const window = remaining.slice(0, limit + 1);
    for (const marker of ['. ', '? ', '! ', '; ', ', ', ' ']) {
      const index = window.lastIndexOf(marker);
      if (index > cut) cut = index + (marker === ' ' ? 0 : 1);
    }
    if (cut < Math.floor(limit * 0.5)) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function createAudioSegment({
  data,
  mimeType = 'audio/wav',
  byteLength = null,
  index = 0,
} = {}) {
  const encoded = String(data || '');
  if (!encoded) throw _badRequest('Audio segment requires base64 data');
  const length = Number(byteLength) || Buffer.from(encoded, 'base64').length;
  return Object.freeze({
    index: Number(index) || 0,
    mimeType: String(mimeType || 'audio/wav'),
    encoding: AI_AUDIO_ENCODINGS.BASE64,
    data: encoded,
    byteLength: length,
  });
}

function createSpeechSynthesisResponse({
  transcript,
  voiceId,
  provider = null,
  modelId = null,
  segments = [],
  latencyMs = null,
  degraded = false,
  failure = null,
  credentialSlot = null,
} = {}) {
  return Object.freeze({
    contractVersion: 1,
    capability: AI_MEDIA_CAPABILITIES.SPEECH_SYNTHESIS,
    transcript: String(transcript ?? ''),
    voiceId: voiceId || null,
    provider,
    modelId,
    audio: Object.freeze({
      mimeType: 'audio/wav',
      segmented: segments.length > 1,
      segments: Object.freeze(segments.map((segment, index) =>
        segment?.encoding === AI_AUDIO_ENCODINGS.BASE64
          ? Object.freeze({ ...segment, index })
          : createAudioSegment({ ...segment, index })
      )),
    }),
    latencyMs: latencyMs == null ? null : Number(latencyMs),
    degraded: Boolean(degraded),
    failure: failure ? Object.freeze({
      code: failure.code || AI_ERROR_CODES.UNKNOWN,
      provider: failure.provider || provider || null,
      retryable: Boolean(failure.retryable),
    }) : null,
    credentialSlot: credentialSlot || null,
  });
}

module.exports = {
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
  normalizeExecutionContent,
  normalizeReasoningDirective,
  normalizeStructuredOutputDirective,
  normalizeGenerationOptions,
  createExecutionRequest,
  createExecutionResponse,
  createSpeechSynthesisRequest,
  splitSpeechTranscript,
  createAudioSegment,
  createSpeechSynthesisResponse,
};
