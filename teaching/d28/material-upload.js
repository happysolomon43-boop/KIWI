'use strict';

const crypto = require('node:crypto');
const pdfParse = require('pdf-parse');
const officeparser = require('officeparser');
const { validateMaterialUpload } = require('./security');

const EXTRACTED_CHUNK_MAX_BYTES = 60 * 1024;
const EXTRACTED_FILE_MAX_BYTES = 768 * 1024;

function uploadError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeExtractedText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function splitUtf8(text, maxBytes = EXTRACTED_CHUNK_MAX_BYTES) {
  const source = String(text || '');
  if (!source) return Object.freeze([]);
  const chunks = [];
  let current = '';
  let currentBytes = 0;

  for (const character of source) {
    const size = Buffer.byteLength(character, 'utf8');
    if (current && currentBytes + size > maxBytes) {
      chunks.push(current.trim());
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += size;
  }
  if (current.trim()) chunks.push(current.trim());
  return Object.freeze(chunks.filter(Boolean));
}

const OFFICE_DECOMPRESSION_LIMITS = Object.freeze({
  maxUncompressedBytes:64 * 1024 * 1024,
  maxZipEntries:5000,
  maxTableCells:250000,
});

async function extractOfficeText(bytes, fileType, parser = officeparser) {
  const ast = await parser.parseOffice(bytes, {
    fileType,
    decompressionLimits:OFFICE_DECOMPRESSION_LIMITS,
  });
  const parsed = await ast.to('text', {
    includeImages:false,
    textConfig:{ preserveLayout:false, renderNotes:true },
  });
  return normalizeExtractedText(parsed?.value);
}

async function extractText(bytes, upload, { pdfParser = pdfParse, officeParser = officeparser } = {}) {
  if (upload.extension === '.pdf') {
    const parsed = await pdfParser(bytes);
    return normalizeExtractedText(parsed?.text);
  }
  if (upload.extension === '.docx') {
    return extractOfficeText(bytes, 'docx', officeParser);
  }
  if (upload.extension === '.txt' || upload.extension === '.md') {
    return normalizeExtractedText(bytes.toString('utf8'));
  }
  if (upload.extension === '.pptx') {
    return extractOfficeText(bytes, 'pptx', officeParser);
  }
  throw uploadError('Unsupported Teaching material type.', 'TEACHING_D28_UPLOAD_TYPE_FORBIDDEN', 415);
}

async function extractValidatedMaterial({ filename, mimeType, bytes }, dependencies = {}) {
  if (!Buffer.isBuffer(bytes)) {
    throw uploadError('Teaching material bytes are required.', 'TEACHING_D28_UPLOAD_BYTES_REQUIRED', 400);
  }

  let upload;
  try {
    upload = validateMaterialUpload({ filename, mimeType, sizeBytes:bytes.length, bytes });
  } catch (error) {
    if (!error.status) {
      error.status = error.code === 'TEACHING_D28_UPLOAD_SIZE_FORBIDDEN' ? 413 : 415;
    }
    throw error;
  }

  let text;
  try {
    text = await extractText(bytes, upload, dependencies);
  } catch (error) {
    if (error?.code) throw error;
    throw uploadError('Teaching material could not be safely extracted.', 'TEACHING_D28_UPLOAD_EXTRACTION_FAILED', 422);
  }

  if (!text) {
    throw uploadError('Teaching material contains no extractable text.', 'TEACHING_D28_UPLOAD_EMPTY_TEXT', 422);
  }

  const extractedBytes = Buffer.byteLength(text, 'utf8');
  if (extractedBytes > EXTRACTED_FILE_MAX_BYTES) {
    throw uploadError(
      'Teaching material contains too much extracted text for a single Course source upload. Split the document into smaller files.',
      'TEACHING_D28_UPLOAD_EXTRACTED_TEXT_TOO_LARGE',
      413
    );
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const chunks = splitUtf8(text);
  if (!chunks.length) {
    throw uploadError('Teaching material contains no extractable text.', 'TEACHING_D28_UPLOAD_EMPTY_TEXT', 422);
  }

  const materials = chunks.map((content, index) => Object.freeze({
    sourceKind:'STUDENT_SUPPLEMENT',
    sourceRef:`supplement:${sha256}:part:${index + 1}`,
    versionRef:`sha256:${sha256}`,
    content,
    locator:Object.freeze({
      filename:upload.filename,
      mime_type:upload.mimeType,
      source_size_bytes:upload.sizeBytes,
      extracted_text_bytes:extractedBytes,
      sha256,
      chunk_index:index + 1,
      chunk_count:chunks.length,
      ingestion_boundary:'D28_VALIDATED_UPLOAD_V1',
    }),
  }));

  return Object.freeze({
    file:Object.freeze({
      filename:upload.filename,
      mimeType:upload.mimeType,
      sizeBytes:upload.sizeBytes,
      sha256,
      extractedTextBytes:extractedBytes,
      chunkCount:materials.length,
    }),
    materials:Object.freeze(materials),
  });
}

module.exports = {
  EXTRACTED_CHUNK_MAX_BYTES,
  EXTRACTED_FILE_MAX_BYTES,
  OFFICE_DECOMPRESSION_LIMITS,
  splitUtf8,
  extractOfficeText,
  extractValidatedMaterial,
};
