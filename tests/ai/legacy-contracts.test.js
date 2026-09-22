'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', '..', 'index.js');
const transportPath = path.join(__dirname, '..', '..', 'services', 'ai', 'gemini-transport.js');
const source = fs.readFileSync(indexPath, 'utf8');
const transportSource = fs.readFileSync(transportPath, 'utf8');
const { AI_TASKS } = require('../../services/ai/task-registry');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('legacy Gemini provider stack is completely removed from the monolith', () => {
  assert.equal((source.match(/geminiModel\.generateContent\s*\(/g) || []).length, 0);
  assert.doesNotMatch(source, /const geminiModel\s*=/);
  assert.doesNotMatch(source, /_geminiKeyObjs|_pickGeminiKey|modelOverride/);
  assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/);
});

test('Gemini provider endpoint exists only in the centralized transport', () => {
  const endpoints = transportSource.match(/generativelanguage\.googleapis\.com/g) || [];
  assert.equal(endpoints.length, 1);
});

test('main CBT preserves output scaling while delegating model, thinking and timeout policy', () => {
  const body = section(
    'async function generateCBTQuestions',
    'async function generateCBTCompletionQuestions'
  );

  assert.match(body, /ai\.run\(\s*_taskId/);
  assert.match(body, /Math\.min\(65536,\s*Math\.max\(24000,\s*count\s*\*\s*900\)\)/);
  assert.match(body, /generationGroupId:\s*_generationGroupId/);
  assert.match(body, /force_type/);
  assert.doesNotMatch(body, /thinkingConfig|modelOverride|gemini-3-/);

  assert.equal(AI_TASKS.MAIN_CBT.reasoning, 'HIGH');
  assert.equal(AI_TASKS.MAIN_CBT.timeoutMs, 180000);
  assert.equal(AI_TASKS.RECKONING_CBT.reasoning, 'HIGH');
  assert.equal(AI_TASKS.RECKONING_CBT.timeoutMs, 180000);
});

test('CBT completion preserves quality rules and follows generation-group affinity', () => {
  const body = section(
    'async function generateCBTCompletionQuestions',
    '// B25: Fallback exam question generator'
  );

  assert.match(body, /ai\.run\(\s*['"]CBT_COMPLETION['"]/);
  assert.match(body, /Math\.min\(65536,\s*Math\.max\(16000,\s*needed\s*\*\s*900\)\)/);
  assert.match(body, /completionGroupId/);
  assert.match(body, /Do NOT ask about any concept, fact, or topic already covered/);
  assert.doesNotMatch(body, /thinkingConfig|modelOverride|gemini-3-/);

  assert.equal(AI_TASKS.CBT_COMPLETION.reasoning, 'HIGH');
  assert.equal(AI_TASKS.CBT_COMPLETION.timeoutMs, 180000);
});

test('flashcard generation is VVIP-routed with its feature-owned output budget', () => {
  const body = section(
    'async function generateFlashcards',
    'async function summarizeCard'
  );

  assert.match(body, /ai\.run\(['"]FLASHCARD_GENERATION['"]/);
  assert.match(body, /maxOutputTokens:\s*15000/);
  assert.doesNotMatch(body, /thinkingConfig|modelOverride|gemini-3-/);
  assert.equal(AI_TASKS.FLASHCARD_GENERATION.reasoning, 'HIGH');
  assert.equal(AI_TASKS.FLASHCARD_GENERATION.timeoutMs, 120000);
});

test('image extraction keeps multimodal inline data through VVIP routing', () => {
  const body = section(
    'async function extractFromImage',
    'async function generateTasksWithGemini'
  );

  assert.match(body, /ai\.run\(['"]IMPORT_IMAGE_EXTRACTION['"]/);
  assert.match(body, /inlineData/);
  assert.equal(AI_TASKS.IMPORT_IMAGE_EXTRACTION.class, 'VVIP');
});

test('custom CBT split-generation and completion safeguards remain present', () => {
  assert.match(source, /\[KIWI CBT\] Split path:/);
  assert.match(source, /force_type:\s*['"]theory['"]/);
  assert.match(source, /force_type:\s*['"]calculation['"]/);
  assert.match(source, /\[KIWI CBT\] Split merge:/);
  assert.match(source, /\[KIWI CBT\] Ratio check:/);
  assert.match(source, /generation_group_id:\s*_cbtSessionId/);
});

test('health diagnostics read the centralized AI project and quota state', () => {
  assert.match(source, /_aiRuntime\.projectPool\.snapshot\(\)/);
  assert.match(source, /_aiRuntime\.quotaManager\?\.snapshot/);
  assert.doesNotMatch(source, /Gemini AI key pool/);
});
