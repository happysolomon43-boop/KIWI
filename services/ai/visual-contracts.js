'use strict';

const crypto = require('node:crypto');
const { AIError, AI_ERROR_CODES } = require('./errors');

const AI_VISUAL_CAPABILITIES = Object.freeze({
  IMAGE_GENERATION: 'IMAGE_GENERATION',
  DIAGRAM_RENDER: 'DIAGRAM_RENDER',
});

const VISUAL_AUTHORITY = Object.freeze({
  ILLUSTRATIVE: 'ILLUSTRATIVE',
  STRUCTURED_EXACT: 'STRUCTURED_EXACT',
});

const GENERATED_IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png']);
const DIAGRAM_OUTPUT_MIME_TYPE = 'image/svg+xml';
const MAX_IMAGE_PROMPT_CHARACTERS = 2048;
const MAX_IMAGE_ALT_CHARACTERS = 300;
const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATED_IMAGE_DIMENSION = 4096;
const MAX_DIAGRAM_SOURCE_CHARACTERS = 50000;
const MAX_DIAGRAM_SVG_BYTES = 2 * 1024 * 1024;

const SUPPORTED_DIAGRAM_TYPES = Object.freeze([
  'graphviz',
  'plantuml',
  'mermaid',
  'd2',
  'erd',
  'wavedrom',
  'vega',
  'vegalite',
]);

function bad(message, details = null) {
  return new AIError(message, {
    code: AI_ERROR_CODES.BAD_REQUEST,
    retryable: false,
    scope: 'REQUEST',
    details,
  });
}

function invalidOutput(message, details = null, provider = null) {
  return new AIError(message, {
    code: AI_ERROR_CODES.INVALID_OUTPUT,
    retryable: false,
    scope: 'ATTEMPT',
    provider,
    details,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function cleanText(value, { name, max }) {
  const text = String(value ?? '').trim();
  if (!text) throw bad(`${name} is required`);
  if (text.length > max) {
    throw bad(`${name} exceeds the KIWI limit`, { characters: text.length, maxCharacters: max });
  }
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw bad(`${name} contains unsupported control characters`);
  }
  return text;
}

function createImageGenerationRequest({
  prompt,
  altText,
  steps = 4,
  seed = null,
  metadata = {},
} = {}) {
  const normalizedPrompt = cleanText(prompt, {
    name: 'Image generation prompt',
    max: MAX_IMAGE_PROMPT_CHARACTERS,
  });
  const normalizedAlt = cleanText(altText || prompt, {
    name: 'Image alt text',
    max: MAX_IMAGE_ALT_CHARACTERS,
  });
  const normalizedSteps = Number(steps);
  if (!Number.isInteger(normalizedSteps) || normalizedSteps < 1 || normalizedSteps > 8) {
    throw bad('Image generation steps must be an integer from 1 to 8');
  }
  let normalizedSeed = null;
  if (seed != null) {
    const parsed = Number(seed);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9999999999) {
      throw bad('Image generation seed must be an integer from 1 to 9999999999');
    }
    normalizedSeed = parsed;
  }

  return Object.freeze({
    contractVersion: 1,
    capability: AI_VISUAL_CAPABILITIES.IMAGE_GENERATION,
    authority: VISUAL_AUTHORITY.ILLUSTRATIVE,
    prompt: normalizedPrompt,
    altText: normalizedAlt,
    steps: normalizedSteps,
    seed: normalizedSeed,
    metadata: Object.freeze({ ...(metadata || {}) }),
  });
}

function imageGenerationCacheKey(request, modelId) {
  return sha256(stableJson({
    capability: AI_VISUAL_CAPABILITIES.IMAGE_GENERATION,
    modelId: String(modelId || ''),
    prompt: request.prompt,
    steps: request.steps,
    seed: request.seed,
  }));
}

function diagramCacheKey(request, rendererId = 'KROKI') {
  return sha256(stableJson({
    capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
    rendererId,
    diagramType: request.diagramType,
    outputFormat: request.outputFormat,
    source: request.source,
  }));
}

function _pngDimensions(bytes) {
  if (bytes.length < 24) return null;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(sig)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mimeType: 'image/png' };
}

function _jpegDimensions(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker) && length >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
        mimeType: 'image/jpeg',
      };
    }
    offset += length;
  }
  return null;
}

function inspectGeneratedImage(dataBase64, provider = null) {
  const encoded = String(dataBase64 || '').replace(/^data:image\/(?:jpeg|png);base64,/i, '').replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw invalidOutput('Generated image is not valid base64', null, provider);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64') !== encoded) {
    throw invalidOutput('Generated image is not canonical base64', null, provider);
  }
  if (bytes.length > MAX_GENERATED_IMAGE_BYTES) {
    throw invalidOutput('Generated image exceeds the KIWI output size limit', {
      byteLength: bytes.length,
      maxBytes: MAX_GENERATED_IMAGE_BYTES,
    }, provider);
  }
  const dimensions = _pngDimensions(bytes) || _jpegDimensions(bytes);
  if (!dimensions || !GENERATED_IMAGE_MIME_TYPES.includes(dimensions.mimeType)) {
    throw invalidOutput('Generated image format or dimensions are invalid', null, provider);
  }
  if (
    dimensions.width < 1 || dimensions.height < 1 ||
    dimensions.width > MAX_GENERATED_IMAGE_DIMENSION ||
    dimensions.height > MAX_GENERATED_IMAGE_DIMENSION
  ) {
    throw invalidOutput('Generated image dimensions exceed the KIWI limit', dimensions, provider);
  }
  return Object.freeze({
    data: encoded,
    byteLength: bytes.length,
    mimeType: dimensions.mimeType,
    width: dimensions.width,
    height: dimensions.height,
  });
}

function createGeneratedImageResponse({
  request,
  provider,
  modelId,
  data,
  cacheKey,
  cacheHit = false,
  latencyMs = null,
  credentialSlot = null,
} = {}) {
  const image = inspectGeneratedImage(data, provider);
  return Object.freeze({
    contractVersion: 1,
    capability: AI_VISUAL_CAPABILITIES.IMAGE_GENERATION,
    authority: VISUAL_AUTHORITY.ILLUSTRATIVE,
    provider,
    modelId: modelId || null,
    altText: request.altText,
    image: Object.freeze(image),
    cacheKey: cacheKey || null,
    cacheHit: Boolean(cacheHit),
    latencyMs: latencyMs == null ? null : Number(latencyMs),
    credentialSlot: credentialSlot || null,
    provenance: Object.freeze({
      generated: true,
      deterministic: false,
      supplementary: true,
      authoritativeDiagram: false,
    }),
  });
}

function _assertDiagramSourceSafe(source, diagramType) {
  if (/\b(?:https?|file|ftp|javascript|data):\/\//i.test(source) || /javascript\s*:/i.test(source)) {
    throw bad('Diagram source may not reference external or executable resources', { diagramType });
  }
  if (/<\s*(?:script|iframe|object|embed|foreignObject)\b/i.test(source)) {
    throw bad('Diagram source contains prohibited executable markup', { diagramType });
  }
  if (/\son[a-z0-9:_-]+\s*=/i.test(source)) {
    throw bad('Diagram source contains prohibited event-handler markup', { diagramType });
  }
  if (diagramType === 'plantuml' && /^\s*!\s*(?:include|includeurl|import)\b/im.test(source)) {
    throw bad('PlantUML imports/includes are prohibited in KIWI diagrams');
  }
}

function createDiagramRenderRequest({
  diagramType,
  source,
  altText,
  fallbackText = null,
  metadata = {},
} = {}) {
  const normalizedType = String(diagramType || '').trim().toLowerCase();
  if (!SUPPORTED_DIAGRAM_TYPES.includes(normalizedType)) {
    throw bad('Unsupported diagram language/type', {
      diagramType: normalizedType || null,
      supportedDiagramTypes: SUPPORTED_DIAGRAM_TYPES,
    });
  }
  const normalizedSource = cleanText(source, {
    name: 'Diagram source',
    max: MAX_DIAGRAM_SOURCE_CHARACTERS,
  });
  _assertDiagramSourceSafe(normalizedSource, normalizedType);
  const normalizedAlt = cleanText(altText || `${normalizedType} diagram`, {
    name: 'Diagram alt text',
    max: MAX_IMAGE_ALT_CHARACTERS,
  });
  const normalizedFallback = fallbackText == null
    ? normalizedAlt
    : cleanText(fallbackText, { name: 'Diagram fallback text', max: 2000 });

  return Object.freeze({
    contractVersion: 1,
    capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
    authority: VISUAL_AUTHORITY.STRUCTURED_EXACT,
    diagramType: normalizedType,
    source: normalizedSource,
    sourceHash: sha256(normalizedSource),
    outputFormat: 'svg',
    outputMimeType: DIAGRAM_OUTPUT_MIME_TYPE,
    altText: normalizedAlt,
    fallbackText: normalizedFallback,
    metadata: Object.freeze({ ...(metadata || {}) }),
  });
}

function sanitizeSvg(svg, provider = null) {
  let value = String(svg ?? '').trim();
  if (!value) throw invalidOutput('Diagram renderer returned empty SVG', null, provider);
  if (Buffer.byteLength(value, 'utf8') > MAX_DIAGRAM_SVG_BYTES) {
    throw invalidOutput('Rendered SVG exceeds the KIWI size limit', {
      byteLength: Buffer.byteLength(value, 'utf8'),
      maxBytes: MAX_DIAGRAM_SVG_BYTES,
    }, provider);
  }
  if (/<!\s*(?:doctype|entity)\b/i.test(value) || /<\?xml-stylesheet\b/i.test(value)) {
    throw invalidOutput('Rendered SVG contains prohibited XML declarations', null, provider);
  }
  if (/<\s*(?:script|foreignObject|iframe|object|embed|audio|video|image)\b/i.test(value)) {
    throw invalidOutput('Rendered SVG contains prohibited active or embedded content', null, provider);
  }
  if (/\son[a-z0-9:_-]+\s*=/i.test(value) || /javascript\s*:/i.test(value) || /\bdata\s*:/i.test(value)) {
    throw invalidOutput('Rendered SVG contains prohibited executable references', null, provider);
  }
  for (const match of value.matchAll(/\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi)) {
    const ref = String(match[2] || '').trim();
    if (ref && !ref.startsWith('#')) {
      throw invalidOutput('Rendered SVG contains an external reference', { referenceType: 'href' }, provider);
    }
  }
  if (/\b(?:href|xlink:href)\s*=\s*[^"'\s>]/i.test(value)) {
    throw invalidOutput('Rendered SVG contains an unsafe unquoted reference', null, provider);
  }
  for (const match of value.matchAll(/url\(([^)]+)\)/gi)) {
    const ref = String(match[1] || '').trim().replace(/^['"]|['"]$/g, '');
    if (ref && !ref.startsWith('#')) {
      throw invalidOutput('Rendered SVG contains an external CSS reference', null, provider);
    }
  }
  if (/@import\b|expression\s*\(/i.test(value)) {
    throw invalidOutput('Rendered SVG contains prohibited stylesheet behavior', null, provider);
  }
  value = value.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*<\?xml[^>]*>\s*/i, '').trim();
  if (!/^<svg\b/i.test(value) || !/<\/svg>\s*$/i.test(value)) {
    throw invalidOutput('Diagram renderer output is not a complete SVG document', null, provider);
  }
  return value;
}

function createDiagramRenderResponse({
  request,
  provider,
  rendererId = 'KROKI',
  svg = null,
  cacheKey,
  cacheHit = false,
  latencyMs = null,
  degraded = false,
  failure = null,
} = {}) {
  const sanitized = degraded ? null : sanitizeSvg(svg, provider);
  return Object.freeze({
    contractVersion: 1,
    capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
    authority: VISUAL_AUTHORITY.STRUCTURED_EXACT,
    provider,
    rendererId,
    diagramType: request.diagramType,
    sourceHash: request.sourceHash,
    output: Object.freeze({
      mimeType: DIAGRAM_OUTPUT_MIME_TYPE,
      encoding: sanitized == null ? null : 'UTF8',
      svg: sanitized,
      byteLength: sanitized == null ? 0 : Buffer.byteLength(sanitized, 'utf8'),
    }),
    altText: request.altText,
    fallback: Object.freeze({ kind: 'TEXT', text: request.fallbackText }),
    cacheKey: cacheKey || null,
    cacheHit: Boolean(cacheHit),
    latencyMs: latencyMs == null ? null : Number(latencyMs),
    degraded: Boolean(degraded),
    failure: failure ? Object.freeze({
      code: failure.code || AI_ERROR_CODES.UNKNOWN,
      retryable: Boolean(failure.retryable),
      provider: failure.provider || provider || null,
    }) : null,
    provenance: Object.freeze({
      generated: false,
      deterministic: true,
      sanitized: sanitized != null,
      supplementary: false,
    }),
  });
}

module.exports = {
  AI_VISUAL_CAPABILITIES,
  VISUAL_AUTHORITY,
  GENERATED_IMAGE_MIME_TYPES,
  DIAGRAM_OUTPUT_MIME_TYPE,
  MAX_IMAGE_PROMPT_CHARACTERS,
  MAX_IMAGE_ALT_CHARACTERS,
  MAX_GENERATED_IMAGE_BYTES,
  MAX_GENERATED_IMAGE_DIMENSION,
  MAX_DIAGRAM_SOURCE_CHARACTERS,
  MAX_DIAGRAM_SVG_BYTES,
  SUPPORTED_DIAGRAM_TYPES,
  createImageGenerationRequest,
  imageGenerationCacheKey,
  inspectGeneratedImage,
  createGeneratedImageResponse,
  createDiagramRenderRequest,
  diagramCacheKey,
  sanitizeSvg,
  createDiagramRenderResponse,
  sha256,
};
