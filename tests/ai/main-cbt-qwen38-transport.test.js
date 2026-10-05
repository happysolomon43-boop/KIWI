'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { createExecutionRequest } = require('../../services/ai/execution-contracts');
const { MODEL_IDS } = require('../../services/ai/model-catalog');
const {
  groqModelOutputTokenLimit,
  isGroqStrictJsonSchemaCompatible,
  serializeGroqExecutionRequest,
} = require('../../services/ai/groq-provider-adapter');

test('Qwen 3.8 Main CBT request serializes HIGH reasoning privately with full completion budget', () => {
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: MODEL_IDS.QWEN_3_8_27B,
    taskId: 'MAIN_CBT',
    content: 'Generate a controlled CBT examination.',
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      maxCompletionTokens: 16384,
    },
  });

  const body = serializeGroqExecutionRequest(request);

  assert.equal(body.model, 'qwen/qwen3.8-27b');
  assert.deepEqual(body.messages, [{
    role: 'user',
    content: 'Generate a controlled CBT examination.',
  }]);
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.reasoning_format, 'hidden');
  assert.equal('include_reasoning' in body, false);
  assert.equal(body.max_completion_tokens, 16384);
});

test('Groq clamps oversized neutral output budgets to the selected Qwen catalog limit', () => {
  assert.equal(groqModelOutputTokenLimit(MODEL_IDS.QWEN_3_8_27B), 16384);

  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: MODEL_IDS.QWEN_3_8_27B,
    taskId: 'MAIN_CBT',
    content: 'Generate the requested structured artifact.',
    generation: {
      reasoning: { requested: 'HIGH', resolved: 'HIGH' },
      maxOutputTokens: 48000,
    },
  });

  const body = serializeGroqExecutionRequest(request);
  assert.equal(body.max_completion_tokens, 16384);
});

test('Groq only requests strict structured output when the schema satisfies strict requirements', () => {
  const strictSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } },
    },
    required: ['status', 'items'],
  };
  const flexibleSchema = {
    type: 'object',
    properties: {
      status: { type: 'string' },
      optional_note: { type: 'string' },
    },
    required: ['status'],
  };

  assert.equal(isGroqStrictJsonSchemaCompatible(strictSchema), true);
  assert.equal(isGroqStrictJsonSchemaCompatible(flexibleSchema), false);

  const strictRequest = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: MODEL_IDS.QWEN_3_8_27B,
    taskId: 'MAIN_CBT',
    content: 'Return strict JSON.',
    generation: { structuredOutput: { schema: strictSchema } },
  });
  const flexibleRequest = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: MODEL_IDS.QWEN_3_8_27B,
    taskId: 'MAIN_CBT',
    content: 'Return schema-guided JSON.',
    generation: { structuredOutput: { schema: flexibleSchema } },
  });

  assert.equal(serializeGroqExecutionRequest(strictRequest).response_format.json_schema.strict, true);
  assert.equal(serializeGroqExecutionRequest(flexibleRequest).response_format.json_schema.strict, false);
});
