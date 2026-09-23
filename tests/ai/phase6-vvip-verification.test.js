'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
const {
  AI_TASKS,
  AI_CLASSES,
  REASONING_LEVELS,
  QUALITY_FLOORS,
} = require('../../services/ai/task-registry');
const { createModelRouter } = require('../../services/ai/model-router');
const { createProjectPool } = require('../../services/ai/project-pool');
const { createAIOrchestrator } = require('../../services/ai/orchestrator');
const { AIError, AI_ERROR_CODES, isAIAvailabilityError } = require('../../services/ai/errors');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function successRaw(text = 'ok') {
  return {
    candidates: [{
      finishReason: 'STOP',
      content: { parts: [{ text }] },
    }],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      thoughtsTokenCount: 2,
      totalTokenCount: 17,
    },
  };
}

test('Phase 6 VVIP canonical tasks include assessment integrity audit', () => {
  const vvip = Object.entries(AI_TASKS)
    .filter(([, config]) => config.class === AI_CLASSES.VVIP)
    .map(([id]) => id)
    .sort();

  assert.deepEqual(vvip, [
    'CBT_COMPLETION',
    'CBT_QUESTION_AUDIT',
    'FLASHCARD_GENERATION',
    'IMPORT_IMAGE_EXTRACTION',
    'MAIN_CBT',
    'RECKONING_CBT',
  ]);

  for (const id of vvip) {
    assert.equal(AI_TASKS[id].qualityFloor, QUALITY_FLOORS.FLASH, id);
    assert.equal(AI_TASKS[id].degradationAllowed, false, id);
  }

  for (const id of ['MAIN_CBT', 'RECKONING_CBT', 'CBT_COMPLETION', 'CBT_QUESTION_AUDIT', 'FLASHCARD_GENERATION']) {
    assert.equal(AI_TASKS[id].reasoning, REASONING_LEVELS.HIGH, id);
  }
  assert.equal(AI_TASKS.IMPORT_IMAGE_EXTRACTION.reasoning, REASONING_LEVELS.MEDIUM);
});

test('all VVIP tasks resolve only to the approved stable Flash VVIP chain', () => {
  const router = createModelRouter();
  const expected = [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ];

  for (const id of [
    'MAIN_CBT',
    'RECKONING_CBT',
    'CBT_COMPLETION',
    'CBT_QUESTION_AUDIT',
    'FLASHCARD_GENERATION',
    'IMPORT_IMAGE_EXTRACTION',
  ]) {
    const models = router.resolveCandidates(id).map((entry) => entry.modelId);
    assert.deepEqual(models, expected, id);
    assert.ok(models.every((model) => !model.includes('lite')), id);
  }
});

test('one VVIP request uses a bounded number of projects before falling to the next Flash model', async () => {
  const slots = Array.from({ length: 14 }, (_, index) => ({
    id: `p${index + 1}`,
    index: index + 1,
    envName: index === 0 ? 'GEMINI_API_KEY' : `GEMINI_API_KEY_${index + 1}`,
    apiKey: `key-${index + 1}`,
  }));

  const calls = [];
  const ai = createAIOrchestrator({
    projectPool: createProjectPool({ slots }),
    logger: { warn() {} },
    transport: {
      async generate(args) {
        calls.push({ modelId: args.modelId, apiKey: args.apiKey });
        if (args.modelId === 'gemini-3.8-flash') {
          throw new AIError('daily quota exhausted', {
            code: AI_ERROR_CODES.RATE_LIMIT_RPD,
            status: 429,
            retryable: true,
            scope: 'MODEL_SLOT',
          });
        }
        return { raw: successRaw('fallback'), latencyMs: 1, httpStatus: 200 };
      },
    },
  });

  const result = await ai.run('MAIN_CBT', { content: 'exam' });

  assert.equal(calls.filter((call) => call.modelId === 'gemini-3.8-flash').length, 14);
  assert.ok(calls.slice(0, 14).every((call) => call.modelId === 'gemini-3.8-flash'));
  assert.equal(calls[14].modelId, 'gemini-3.7-flash');
  assert.equal(result.requestedModel, 'gemini-3.7-flash');
});

test('main CBT and Reckoning CBT share implementation but keep distinct VVIP task identities', () => {
  const body = section(
    'async function generateCBTQuestions',
    'async function generateCBTCompletionQuestions'
  );
  const generationRoute = section(
    'const _cbtUserId',
    '// ── POST /api/exams/:id/forfeit'
  );

  assert.match(body, /const _taskId\s*=\s*_opts\.ai_task_id\s*\|\|\s*['"]MAIN_CBT['"]/);
  assert.match(body, /ai\.run\(\s*_taskId/);
  assert.match(body, /generationGroupId:\s*_generationGroupId/);

  assert.match(
    generationRoute,
    /ai_task_id:\s*isReckoningExam\s*\?\s*['"]RECKONING_CBT['"]\s*:\s*['"]MAIN_CBT['"]/
  );
  assert.match(generationRoute, /generation_group_id:\s*_cbtSessionId/);
});

test('CBT completion preserves generation affinity and the established scaled output budget', () => {
  const body = section(
    'async function generateCBTCompletionQuestions',
    '// B25: Fallback exam question generator'
  );

  assert.match(body, /ai\.run\(\s*['"]CBT_COMPLETION['"]/);
  assert.match(body, /generationGroupId:\s*completionGroupId/);
  assert.match(body, /Math\.min\(24000,\s*Math\.max\(6000,\s*needed\s*\*\s*700\)\)/);
});

test('flashcard generation and image extraction are fully live VVIP routes', () => {
  const flashcards = section('async function generateFlashcards', 'async function summarizeCard');
  const image = section('async function extractFromImage', 'async function generateTasksWithGemini');

  assert.match(flashcards, /ai\.run\(['"]FLASHCARD_GENERATION['"]/);
  assert.match(flashcards, /maxOutputTokens:\s*15000/);

  assert.match(image, /ai\.run\(['"]IMPORT_IMAGE_EXTRACTION['"]/);
  assert.match(image, /inlineData/);
  assert.match(image, /mimeType/);
});

test('CBT recovery is limited to availability/parser failure and does not treat safety or bad requests as availability', () => {
  assert.equal(isAIAvailabilityError(new AIError('daily', { code: AI_ERROR_CODES.RATE_LIMIT_RPD })), true);
  assert.equal(isAIAvailabilityError(new AIError('timeout', { code: AI_ERROR_CODES.TIMEOUT })), true);
  assert.equal(isAIAvailabilityError(new AIError('safety', { code: AI_ERROR_CODES.SAFETY })), false);
  assert.equal(isAIAvailabilityError(new AIError('bad request', { code: AI_ERROR_CODES.BAD_REQUEST })), false);

  const generationRoute = section(
    'const _cbtUserId',
    '// ── POST /api/exams/:id/forfeit'
  );
  assert.match(generationRoute, /isAIAvailabilityError\(generationErr\)/);
  assert.match(generationRoute, /could not be parsed\|empty response\|no visible text/i);
  assert.match(generationRoute, /generateFallbackExamQuestions/);
});

test('Phase 6 leaves no legacy provider routing in feature code', () => {
  assert.equal((source.match(/\bgeminiModel\.generateContent\s*\(/g) || []).length, 0);
  assert.equal((source.match(/\bai\.run\s*\(/g) || []).length, 30);
  assert.match(source, /createQuestionBank\([\s\S]*aiRun:\s*\(taskId, input, context\)\s*=>\s*ai\.run/);
  assert.match(source, /createAISemanticReviewer\([\s\S]*aiRun:\s*\(taskId, input, context\)\s*=>\s*ai\.run/);
  assert.doesNotMatch(source, /const geminiModel\s*=\s*\{/);
  assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(source, /thinkingConfig\s*:/);
  assert.doesNotMatch(source, /modelOverride\s*:/);
  assert.doesNotMatch(source, /gemini-\d+(?:\.\d+)?-[a-z0-9-]+/i);
});