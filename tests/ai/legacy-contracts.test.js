'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', '..', 'index.js');
const source = fs.readFileSync(indexPath, 'utf8');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('legacy Gemini inventory remains exactly 27 direct calls before migration', () => {
  const calls = source.match(/geminiModel\.generateContent\s*\(/g) || [];
  assert.equal(
    calls.length,
    27,
    'Phase 1 inventory changed: update the canonical inventory before migrating'
  );
});

test('legacy Gemini transport remains centralized in one provider endpoint', () => {
  const endpoints = source.match(/generativelanguage\.googleapis\.com/g) || [];
  assert.equal(endpoints.length, 1);
  assert.match(source, /const geminiModel\s*=\s*\{/);
});

test('main CBT generation preserves the current high-thinking long-running contract', () => {
  const body = section(
    'async function generateCBTQuestions',
    'async function generateCBTCompletionQuestions'
  );

  assert.match(body, /thinkingLevel:\s*['"]high['"]/);
  assert.match(body, /timeoutMs:\s*180000/);
  assert.match(body, /Math\.min\(65536,\s*Math\.max\(24000,\s*count\s*\*\s*900\)\)/);
  assert.match(body, /force_type/);
  assert.match(body, /gemini-3-flash-preview/);
});

test('CBT completion preserves high reasoning and completion token scaling', () => {
  const body = section(
    'async function generateCBTCompletionQuestions',
    '// B25: Fallback exam question generator'
  );

  assert.match(body, /thinkingLevel:\s*['"]high['"]/);
  assert.match(body, /timeoutMs:\s*180000/);
  assert.match(body, /Math\.min\(65536,\s*Math\.max\(16000,\s*needed\s*\*\s*900\)\)/);
  assert.match(body, /Do NOT ask about any concept, fact, or topic already covered/);
});

test('flashcard generation preserves its current high-thinking generation contract', () => {
  const body = section(
    'async function generateFlashcards',
    'async function summarizeCard'
  );

  assert.match(body, /thinkingLevel:\s*['"]high['"]/);
  assert.match(body, /timeoutMs:\s*120000/);
  assert.match(body, /modelOverride:\s*['"]gemini-3-flash-preview['"]/);
  assert.match(body, /maxOutputTokens:\s*15000/);
});

test('card explanation preserves the current fast minimal-thinking contract', () => {
  const body = section(
    'async function summarizeCard',
    'async function extractFromImage'
  );

  assert.match(body, /thinkingLevel:\s*['"]minimal['"]/);
  assert.match(body, /timeoutMs:\s*25000/);
});

test('custom CBT split-generation and completion safeguards remain present', () => {
  assert.match(source, /\[KIWI CBT\] Split path:/);
  assert.match(source, /force_type:\s*['"]theory['"]/);
  assert.match(source, /force_type:\s*['"]calculation['"]/);
  assert.match(source, /\[KIWI CBT\] Split merge:/);
  assert.match(source, /\[KIWI CBT\] Ratio check:/);
});

test('legacy wrapper still filters thought parts before returning visible text', () => {
  assert.match(source, /_parts\.find\(p\s*=>\s*!p\.thought\)/);
});
