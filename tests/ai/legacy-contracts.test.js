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

test('Phase 6 removes every direct legacy Gemini callsite', () => {
  const calls = source.match(/geminiModel\.generateContent\s*\(/g) || [];
  assert.equal(calls.length, 0);
  assert.doesNotMatch(source, /const geminiModel\s*=\s*\{/);
  assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/);
});

test('main and Reckoning CBT delegate model, key, timeout, and thinking policy to the orchestrator', () => {
  const body = section(
    'async function generateCBTQuestions',
    'async function generateCBTCompletionQuestions'
  );

  assert.match(body, /const _taskId\s*=\s*_opts\.ai_task_id\s*\|\|\s*['"]MAIN_CBT['"]/);
  assert.match(body, /ai\.run\(\s*_taskId/);
  assert.match(body, /generationGroupId:\s*_generationGroupId/);
  assert.match(body, /Math\.min\(48000,\s*Math\.max\(8000,\s*count\s*\*\s*700\)\)/);
  assert.match(body, /force_type/);
  assert.doesNotMatch(body, /thinkingConfig/);
  assert.doesNotMatch(body, /gemini-/i);
});

test('CBT completion is a VVIP orchestrator task with output scaling and generation affinity', () => {
  const body = section(
    'async function generateCBTCompletionQuestions',
    '// B25: Fallback exam question generator'
  );

  assert.match(body, /ai\.run\(\s*['"]CBT_COMPLETION['"]/);
  assert.match(body, /generationGroupId:\s*completionGroupId/);
  assert.match(body, /Math\.min\(24000,\s*Math\.max\(6000,\s*needed\s*\*\s*700\)\)/);
  assert.match(body, /Do NOT ask about any concept, fact, or topic already covered/);
  assert.doesNotMatch(body, /thinkingConfig/);
});

test('flashcard generation is VVIP and keeps its established output budget', () => {
  const body = section(
    'async function generateFlashcards',
    'async function summarizeCard'
  );

  assert.match(body, /ai\.run\(['"]FLASHCARD_GENERATION['"]/);
  assert.match(body, /maxOutputTokens:\s*15000/);
  assert.doesNotMatch(body, /thinkingConfig/);
  assert.doesNotMatch(body, /modelOverride/);
});

test('image extraction uses the VVIP orchestrator vision path', () => {
  const body = section(
    'async function extractFromImage',
    'async function generateTasksWithGemini'
  );

  assert.match(body, /ai\.run\(['"]IMPORT_IMAGE_EXTRACTION['"]/);
  assert.match(body, /inlineData/);
  assert.match(body, /mimeType/);
  assert.doesNotMatch(body, /geminiModel\.generateContent/);
});

test('card explanation remains live through the IP orchestrator task', () => {
  const body = section(
    'async function summarizeCard',
    'async function extractFromImage'
  );

  assert.match(body, /ai\.run\(['"]CARD_EXPLANATION['"]/);
  assert.doesNotMatch(body, /thinkingConfig/);
});

test('custom CBT split-generation and completion safeguards remain present', () => {
  assert.match(source, /\[KIWI CBT\] Split path:/);
  assert.match(source, /force_type:\s*['"]theory['"]/);
  assert.match(source, /force_type:\s*['"]calculation['"]/);
  assert.match(source, /\[KIWI CBT\] Split merge:/);
  assert.match(source, /\[KIWI CBT\] Ratio check:/);
});

test('normal and Reckoning CBT retain deterministic availability recovery', () => {
  assert.match(source, /function generateFallbackExamQuestions/);
  assert.match(source, /isAIAvailabilityError\(generationErr\)/);
  assert.match(source, /MAIN_CBT and Reckoning both get a deterministic availability fallback/);
  assert.match(source, /using deterministic recovery exam/);
});
