'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_PROVIDERS } = require('../../services/ai/providers');
const { createExecutionRequest } = require('../../services/ai/execution-contracts');
const { GROQ_MODEL_IDS } = require('../../services/ai/model-catalog');
const { serializeGroqExecutionRequest } = require('../../services/ai/groq-provider-adapter');

test('Qwen 3.8 Main CBT request serializes HIGH reasoning privately with full completion budget', () => {
  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GROQ,
    modelId: GROQ_MODEL_IDS.QWEN_3_8_27B,
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
