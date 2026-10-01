'use strict';

const { createProviderModelRef } = require('./providers');
const { AIError, AI_ERROR_CODES } = require('./errors');

const AI_CONTENT_KINDS = Object.freeze({
  TEXT: 'TEXT',
  MULTIMODAL: 'MULTIMODAL',
});

const AI_CONTENT_PART_KINDS = Object.freeze({
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
});

const AI_CAPABILITIES = Object.freeze({
  GENERATE_CONTENT: 'GENERATE_CONTENT',
  REASONING: 'REASONING',
  STRUCTURED_OUTPUT: 'STRUCTURED_OUTPUT',
  LONG_OUTPUT: 'LONG_OUTPUT',
  SPEECH_SYNTHESIS: 'SPEECH_SYNTHESIS',
  IMAGE_GENERATION: 'IMAGE_GENERATION',
  DIAGRAM_RENDER: 'DIAGRAM_RENDER',
});

const AI_MEDIA_CAPABILITIES = Object.freeze({
  SPEECH_SYNTHESIS: AI_CAPABILITIES.SPEECH_SYNTHESIS,
});

const AI_AUDIO_ENCODINGS = Object.freeze({ BASE64: 'BASE64' });
const SUPPORTED_IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MAX_INPUT_IMAGES = 3;
const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SPEECH_CHUNK_CHARACTERS = 200;
const MAX_SPEECH_TRANSCRIPT_CHARACTERS = 2000;

function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) {}
  }
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function badRequest(message, details = null) {
  return new AIError(message, { code: AI_ERROR_CODES.BAD_REQUEST, retryable: false, scope: 'REQUEST', details });
}

function normalizedBase64(value) {
  const data = String(value || '').replace(/\s+/g, '');
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw badRequest('Image data must be valid padded base64');
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.toString('base64') !== data) throw badRequest('Image data must be canonical base64');
  return { data, bytes };
}

function createTextContentPart(text) {
  const value = String(text ?? '');
  if (!value.trim()) throw badRequest('Text content part cannot be empty');
  return Object.freeze({ kind: AI_CONTENT_PART_KINDS.TEXT, text: value });
}

function createImageContentPart({ mimeType, data, name = null } = {}) {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(normalizedMime)) {
    throw badRequest('Unsupported image MIME type', { mimeType: normalizedMime || null, supportedMimeTypes: SUPPORTED_IMAGE_MIME_TYPES });
  }
  const normalized = normalizedBase64(data);
  const bytes = normalized.bytes;
  const signatureValid =
    (normalizedMime === 'image/png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) ||
    (normalizedMime === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (normalizedMime === 'image/webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!signatureValid) throw badRequest('Image bytes do not match the declared MIME type', { mimeType: normalizedMime });
  if (bytes.length > MAX_INPUT_IMAGE_BYTES) {
    throw badRequest('Image exceeds the KIWI input size limit', { byteLength: bytes.length, maxBytes: MAX_INPUT_IMAGE_BYTES });
  }
  return Object.freeze({
    kind: AI_CONTENT_PART_KINDS.IMAGE,
    mimeType: normalizedMime,
    byteLength: bytes.length,
    name: name ? String(name).slice(0, 160) : null,
    source: Object.freeze({ kind: 'BASE64', data: normalized.data }),
  });
}

function normalizePart(part) {
  if (!part || typeof part !== 'object') throw badRequest('Content part must be an object');
  if (part.kind === AI_CONTENT_PART_KINDS.TEXT || part.type === 'text' || typeof part.text === 'string') {
    return createTextContentPart(part.text);
  }
  if (part.kind === AI_CONTENT_PART_KINDS.IMAGE || part.type === 'image') {
    const image = part.image || part;
    return createImageContentPart({ mimeType: image.mimeType, data: image.source?.data ?? image.data ?? image.dataBase64, name: image.name || null });
  }
  if (part.inlineData && typeof part.inlineData === 'object') {
    return createImageContentPart({ mimeType: part.inlineData.mimeType, data: part.inlineData.data });
  }
  throw badRequest(`Unsupported content part ${part.kind || part.type || 'UNKNOWN'}`);
}

function createMultimodalContent(parts = []) {
  if (!Array.isArray(parts) || !parts.length) throw badRequest('Multimodal content requires content parts');
  const normalized = parts.map(normalizePart);
  const images = normalized.filter((part) => part.kind === AI_CONTENT_PART_KINDS.IMAGE);
  if (!images.length) throw badRequest('Multimodal content requires at least one image');
  if (images.length > MAX_INPUT_IMAGES) throw badRequest(`At most ${MAX_INPUT_IMAGES} images are supported`);
  const totalImageBytes = images.reduce((sum, image) => sum + image.byteLength, 0);
  if (totalImageBytes > MAX_INPUT_IMAGE_TOTAL_BYTES) throw badRequest('Combined image input exceeds the KIWI size limit');
  return Object.freeze({
    kind: AI_CONTENT_KINDS.MULTIMODAL,
    parts: Object.freeze(normalized),
    media: Object.freeze({ imageCount: images.length, imageMimeTypes: Object.freeze([...new Set(images.map((image) => image.mimeType))]), totalImageBytes }),
  });
}

function providerShapedParts(content) {
  if (!content || typeof content !== 'object' || !Array.isArray(content.contents)) return null;
  const parts = [];
  for (const message of content.contents) if (Array.isArray(message?.parts)) parts.push(...message.parts);
  return parts.length ? parts : null;
}

function normalizeExecutionContent(content) {
  if (content?.kind === AI_CONTENT_KINDS.TEXT) return Object.freeze({ kind: AI_CONTENT_KINDS.TEXT, text: String(content.text ?? '') });
  if (content?.kind === AI_CONTENT_KINDS.MULTIMODAL) return createMultimodalContent(content.parts);
  if (typeof content === 'string' || content == null) return Object.freeze({ kind: AI_CONTENT_KINDS.TEXT, text: String(content ?? '') });
  if (Array.isArray(content)) return createMultimodalContent(content);
  const boundaryParts = providerShapedParts(content);
  if (boundaryParts) return createMultimodalContent(boundaryParts);
  if (typeof content?.text === 'string') return Object.freeze({ kind: AI_CONTENT_KINDS.TEXT, text: content.text });
  throw badRequest('AI content must be text or neutral content parts');
}

function normalizeGenerationOptions(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const normalized = {};
  for (const [key, value] of Object.entries(source)) if (value !== undefined) normalized[key] = clone(value);
  return Object.freeze(normalized);
}

function createExecutionRequest({ provider, modelId, taskId = null, content = '', generation = {}, metadata = {} } = {}) {
  const model = createProviderModelRef({ provider, modelId });
  return Object.freeze({
    contractVersion: 2,
    provider: model.provider,
    model,
    taskId: taskId || null,
    content: normalizeExecutionContent(content),
    generation: normalizeGenerationOptions(generation),
    metadata: Object.freeze({ ...(metadata || {}) }),
  });
}

function createExecutionResponse({ provider, requestedModel, providerModel = null, text = '', structuredData = null, finishReason = 'UNKNOWN', blocked = false, blockReason = null, usage = {}, latencyMs = null, credentialSlot = null, fallbackDepth = 0, generationGroupId = null, providerMetadata = null } = {}) {
  const model = createProviderModelRef({ provider, modelId: requestedModel });
  return Object.freeze({
    contractVersion: 2,
    provider: model.provider,
    text: String(text ?? ''),
    structuredData: structuredData == null ? null : Object.freeze(clone(structuredData)),
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
    providerMetadata: providerMetadata == null ? null : Object.freeze(clone(providerMetadata)),
    usage: Object.freeze({ inputTokens: Number(usage.inputTokens) || 0, outputTokens: Number(usage.outputTokens) || 0, thoughtTokens: Number(usage.thoughtTokens) || 0, totalTokens: Number(usage.totalTokens) || 0, cachedContentTokens: Number(usage.cachedContentTokens) || 0 }),
  });
}

function createSpeechSynthesisRequest({ transcript, voiceId = 'KIWI_TEACHER_EN_PRIMARY', language = 'en', metadata = {} } = {}) {
  const text = String(transcript ?? '');
  if (!text.trim()) throw badRequest('Speech synthesis requires a transcript');
  if (text.length > MAX_SPEECH_TRANSCRIPT_CHARACTERS) throw badRequest('Speech transcript exceeds the KIWI voice limit');
  return Object.freeze({ contractVersion: 2, capability: AI_CAPABILITIES.SPEECH_SYNTHESIS, transcript: text, voiceId: String(voiceId || 'KIWI_TEACHER_EN_PRIMARY'), language: String(language || 'en'), responseFormat: 'wav', metadata: Object.freeze({ ...(metadata || {}) }) });
}

function splitSpeechTranscript(transcript, maxCharacters = MAX_SPEECH_CHUNK_CHARACTERS) {
  const text = String(transcript ?? '').trim();
  const limit = Math.max(1, Math.min(MAX_SPEECH_CHUNK_CHARACTERS, Number(maxCharacters) || MAX_SPEECH_CHUNK_CHARACTERS));
  if (!text) return [];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(' '));
    if (cut < Math.floor(limit * 0.5)) cut = limit; else cut += 1;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function createAudioSegment({ data, mimeType = 'audio/wav', byteLength = null, index = 0 } = {}) {
  const encoded = String(data || '');
  if (!encoded) throw badRequest('Audio segment requires base64 data');
  return Object.freeze({ index: Number(index) || 0, mimeType: String(mimeType || 'audio/wav'), encoding: AI_AUDIO_ENCODINGS.BASE64, data: encoded, byteLength: Number(byteLength) || Buffer.from(encoded, 'base64').length });
}

function createSpeechSynthesisResponse({ transcript, voiceId, provider = null, modelId = null, segments = [], latencyMs = null, degraded = false, failure = null, credentialSlot = null } = {}) {
  return Object.freeze({
    contractVersion: 2,
    capability: AI_CAPABILITIES.SPEECH_SYNTHESIS,
    transcript: String(transcript ?? ''),
    voiceId: voiceId || null,
    provider,
    modelId,
    audio: Object.freeze({ mimeType: 'audio/wav', segmented: segments.length > 1, segments: Object.freeze(segments.map((segment, index) => Object.freeze({ ...segment, index }))) }),
    latencyMs: latencyMs == null ? null : Number(latencyMs),
    degraded: Boolean(degraded),
    failure: failure ? Object.freeze({ code: failure.code || AI_ERROR_CODES.UNKNOWN, provider: failure.provider || provider || null, retryable: Boolean(failure.retryable) }) : null,
    credentialSlot: credentialSlot || null,
  });
}

module.exports = {
  AI_CONTENT_KINDS,
  AI_CONTENT_PART_KINDS,
  AI_CAPABILITIES,
  AI_MEDIA_CAPABILITIES,
  AI_AUDIO_ENCODINGS,
  SUPPORTED_IMAGE_MIME_TYPES,
  MAX_INPUT_IMAGES,
  MAX_INPUT_IMAGE_BYTES,
  MAX_INPUT_IMAGE_TOTAL_BYTES,
  MAX_SPEECH_CHUNK_CHARACTERS,
  MAX_SPEECH_TRANSCRIPT_CHARACTERS,
  createTextContentPart,
  createImageContentPart,
  createMultimodalContent,
  normalizeExecutionContent,
  normalizeGenerationOptions,
  createExecutionRequest,
  createExecutionResponse,
  createSpeechSynthesisRequest,
  splitSpeechTranscript,
  createAudioSegment,
  createSpeechSynthesisResponse,
};
