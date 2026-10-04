'use strict';
const crypto = require('node:crypto');
const { TRUSTED_BACKEND_ACTIONS, PROHIBITED_OPERATIONAL_KEYS } = require('./contracts');

const DANGEROUS_KEY = /^(?:on[a-z]+|html|script|srcdoc|dangerouslysetinnerhtml)$/i;
const DANGEROUS_URI = /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i;
const ALLOWED_UPLOADS = Object.freeze({
  'application/pdf':['.pdf'],
  'text/plain':['.txt','.md'],
  'text/markdown':['.md'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx'],
});

function cleanString(value, maxLength = 20_000) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength);
}

function sanitizeStructuredContent(value, { depth = 0, maxDepth = 12 } = {}) {
  if (depth > maxDepth) throw Object.assign(new Error('Structured content exceeds the safe nesting limit.'), { code:'TEACHING_D28_CONTENT_DEPTH_EXCEEDED' });
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const text = cleanString(value);
    if (DANGEROUS_URI.test(text)) throw Object.assign(new Error('Unsafe URI scheme is not allowed.'), { code:'TEACHING_D28_UNSAFE_URI' });
    return text;
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeStructuredContent(item, { depth:depth + 1, maxDepth }));
  if (typeof value !== 'object') return cleanString(value);
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 500)) {
    const key = cleanString(rawKey, 120);
    if (!key || DANGEROUS_KEY.test(key)) throw Object.assign(new Error(`Unsafe structured-content field: ${key || 'unknown'}`), { code:'TEACHING_D28_UNSAFE_RENDER_FIELD' });
    out[key] = sanitizeStructuredContent(rawValue, { depth:depth + 1, maxDepth });
  }
  return Object.freeze(out);
}

function safeBasename(name) {
  return cleanString(name, 255).replace(/[/\\]/g, '_').trim();
}
function extensionOf(name) {
  const normalized = safeBasename(name).toLowerCase();
  const index = normalized.lastIndexOf('.');
  return index >= 0 ? normalized.slice(index) : '';
}
function magicMatches(mimeType, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return true;
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  return true;
}
function validateMaterialUpload({ filename, mimeType, sizeBytes, bytes = null }, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const name = safeBasename(filename);
  const mime = cleanString(mimeType, 150).toLowerCase();
  const size = Number(sizeBytes);
  if (!name || !ALLOWED_UPLOADS[mime]) throw Object.assign(new Error('Unsupported Teaching material type.'), { code:'TEACHING_D28_UPLOAD_TYPE_FORBIDDEN' });
  if (!Number.isFinite(size) || size < 0 || size > maxBytes) throw Object.assign(new Error('Teaching material size is outside the allowed limit.'), { code:'TEACHING_D28_UPLOAD_SIZE_FORBIDDEN' });
  const ext = extensionOf(name);
  if (!ALLOWED_UPLOADS[mime].includes(ext)) throw Object.assign(new Error('File extension does not match the declared material type.'), { code:'TEACHING_D28_UPLOAD_EXTENSION_MISMATCH' });
  if (!magicMatches(mime, bytes)) throw Object.assign(new Error('File signature does not match the declared material type.'), { code:'TEACHING_D28_UPLOAD_SIGNATURE_MISMATCH' });
  return Object.freeze({ filename:name, mimeType:mime, sizeBytes:size, extension:ext });
}

const D07_SUPPLEMENT_MAX_TEXT_BYTES = 64 * 1024;
const D07_BINARY_UPLOAD_FIELDS = Object.freeze([
  'filename','fileName','mimeType','mime_type','sizeBytes','size_bytes',
  'bytes','base64','fileBase64','contentBase64','binary','buffer',
]);

function validateSupplementaryMaterialInput(material, { maxTextBytes = D07_SUPPLEMENT_MAX_TEXT_BYTES } = {}) {
  if (!material || typeof material !== 'object' || Array.isArray(material)) {
    throw Object.assign(new Error('Teaching supplementary material must be an object.'), { code:'TEACHING_D28_SUPPLEMENT_OBJECT_REQUIRED' });
  }
  const binaryFields = D07_BINARY_UPLOAD_FIELDS.filter((key) => material[key] != null);
  if (binaryFields.length) {
    throw Object.assign(
      new Error('Binary Teaching material must pass through a dedicated validated upload boundary before D07 source ingestion.'),
      { code:'TEACHING_D28_SUPPLEMENT_BINARY_UPLOAD_REQUIRES_VALIDATED_BOUNDARY', fields:Object.freeze(binaryFields) }
    );
  }
  const content = String(material.content == null ? '' : material.content);
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (!content.trim()) {
    throw Object.assign(new Error('Teaching supplementary material content is required.'), { code:'TEACHING_D28_SUPPLEMENT_CONTENT_REQUIRED' });
  }
  if (contentBytes > maxTextBytes) {
    throw Object.assign(new Error('Teaching supplementary material exceeds the bounded extracted-text limit.'), { code:'TEACHING_D28_SUPPLEMENT_TEXT_SIZE_FORBIDDEN' });
  }
  return Object.freeze({ ...material, content });
}

function assertTrustedBackendAction(action, actor = {}) {
  const normalized = String(action || '').toUpperCase();
  if (!TRUSTED_BACKEND_ACTIONS.has(normalized)) return true;
  if (actor.trustedBackend === true || actor.serviceRole === true || actor.role === 'teaching_domain_service') return true;
  const error = new Error(`${normalized} requires a trusted backend context.`);
  error.code = 'TEACHING_D28_TRUSTED_BACKEND_REQUIRED';
  error.status = 403;
  throw error;
}

function redactOperationalMetadata(value, { depth = 0 } = {}) {
  if (depth > 8) return '[TRUNCATED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return cleanString(value, 1000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactOperationalMetadata(item, { depth:depth + 1 }));
  if (typeof value !== 'object') return cleanString(value, 1000);
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    const key = String(rawKey).toLowerCase();
    if (PROHIBITED_OPERATIONAL_KEYS.has(key) || /(?:secret|password|authorization|cookie|chain.?of.?thought|hidden.?reason)/i.test(key)) {
      out[rawKey] = '[REDACTED]';
      continue;
    }
    out[rawKey] = redactOperationalMetadata(rawValue, { depth:depth + 1 });
  }
  return Object.freeze(out);
}

function opaqueStudentRef(studentId, secret) {
  if (!studentId || !secret) return null;
  return crypto.createHmac('sha256', String(secret)).update(String(studentId)).digest('hex').slice(0, 32);
}

function assertContextMinimized({ allowedClasses = [], prohibitedClasses = [], context = {} } = {}) {
  const allowed = new Set(allowedClasses.map(String));
  const prohibited = new Set(prohibitedClasses.map(String));
  const keys = Object.keys(context || {});
  for (const key of keys) {
    if (prohibited.has(key)) throw Object.assign(new Error(`Prohibited context class ${key} supplied.`), { code:'TEACHING_D28_CONTEXT_PROHIBITED' });
    if (allowed.size && !allowed.has(key)) throw Object.assign(new Error(`Unapproved context class ${key} supplied.`), { code:'TEACHING_D28_CONTEXT_NOT_ALLOWED' });
  }
  return true;
}

function protectedAssessmentContentAllowed({ released = false, purpose = 'STUDENT_QUERY' } = {}) {
  if (released) return true;
  return ['PACKAGE_VALIDATION','FORMAL_MARKING','MODERATION','POST_EXPOSURE_REPAIR'].includes(String(purpose));
}

module.exports = {
  sanitizeStructuredContent,
  validateMaterialUpload,
  validateSupplementaryMaterialInput,
  assertTrustedBackendAction,
  redactOperationalMetadata,
  opaqueStudentRef,
  assertContextMinimized,
  protectedAssessmentContentAllowed,
};
