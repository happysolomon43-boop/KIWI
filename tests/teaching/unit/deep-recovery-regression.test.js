'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serializeAcademicInput, SOURCE_CENSUS_INPUT_LIMITS } = require('../../../teaching/prompt-runtime/academic-input');
const { createReckoningStore } = require('../../../services/reckoning/store');
const { createCentralAIExecutionBoundary } = require('../../../teaching/ai/central-orchestrator-boundary');
const read = file => fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');

test('full source census retains every item beyond 64 KiB without loosening ordinary inputs', () => {
  const input = { source_items: Array.from({ length: 141 }, (_, i) => ({ source_item_ref: `source:${i}`, content: 'material '.repeat(100) })) };
  assert.throws(() => serializeAcademicInput(input), { code: 'TEACHING_ACADEMIC_INPUT_INVALID' });
  assert.deepEqual(JSON.parse(serializeAcademicInput(input, SOURCE_CENSUS_INPUT_LIMITS)), input);
  assert.throws(() => serializeAcademicInput({ text: 'x'.repeat(1_048_576) }, SOURCE_CENSUS_INPUT_LIMITS), { code: 'TEACHING_ACADEMIC_INPUT_INVALID' });
  assert.throws(() => serializeAcademicInput(input, { bytes: Infinity }), /server-owned policy/);
});

test('source census still rejects cycles, getters, non-JSON values and excessive depth', () => {
  const cyclic = {}; cyclic.self = cyclic;
  const getter = {}; Object.defineProperty(getter, 'unsafe', { enumerable: true, get() { throw new Error('executed'); } });
  let deep = {}; for (let i = 0; i < 17; i++) deep = { child: deep };
  for (const input of [cyclic, getter, deep, { value: NaN }]) {
    assert.throws(() => serializeAcademicInput(input, SOURCE_CENSUS_INPUT_LIMITS), { code: 'TEACHING_ACADEMIC_INPUT_INVALID' });
  }
});

test('Reckoning answer SQL assigns one integer type to response time and clamps inputs', async () => {
  const calls = [];
  const store = createReckoningStore({ query: async (sql, values) => { calls.push({ sql, values }); return { rows: [{ id: 'q' }] }; } });
  for (const value of [1234.6, -1, Infinity]) {
    await store.saveQuestionAnswer('u', 'exam', 'q', { selectedOption: 'A', isCorrect: true, responseTimeMs: value });
  }
  assert.deepEqual(calls.map(call => call.values[5]), [1235, 0, 2147483647]);
  assert.match(calls[0].sql, /response_time_ms = \$6::integer/);
  assert.match(calls[0].sql, /time_spent_seconds = \(\$6::integer \/ 1000\)/);
  assert.doesNotMatch(calls[0].sql, /\$6::numeric/);
});

test('truncated Teaching output preserves provider and usage evidence without accepting output', async () => {
  let recorded;
  const boundary = createCentralAIExecutionBoundary({
    aiRun: async () => ({ finishReason: 'MAX_TOKENS', modelId: 'test-model', provider: 'GOOGLE', usage: { inputTokens: 200, outputTokens: 60, totalTokens: 1800 } }),
    telemetry: { beginExecution: async () => 'execution', finishExecution: async (_, meta) => { recorded = meta; } },
  });
  await assert.rejects(boundary.execute({ taskId: 'MAIN_CBT', intelligenceClass: 'DIRECT-AI', authorityLevel: 'T2' }), { code: 'TEACHING_AI_OUTPUT_TRUNCATED' });
  assert.equal(recorded.modelIdentifier, 'test-model');
  assert.equal(recorded.outputTokens, 60);
  assert.equal(recorded.validationOutcome, 'FAILED');
});

test('admin diagnostic provides room for reasoning and structured output', () => {
  const source = read('teaching/admin-ai-diagnostics.js');
  assert.match(source, /maxOutputTokens:16384/);
  assert.doesNotMatch(source, /maxOutputTokens:1600\b/);
});

test('draft creation exposes existing drafts and preserves partial success for retry', () => {
  const source = read('public/teaching.js');
  assert.match(source, /Open existing course/);
  assert.match(source, /createdCourse \|\| await kiwiApiRequest/);
  assert.match(source, /Open saved draft/);
  assert.match(source, /Retry saving context/);
  assert.match(read('teaching-backend.js'), /courseId: error.courseId/);
  assert.match(read('public/kiwi-api-client.js'), /error.courseId =/);
});
