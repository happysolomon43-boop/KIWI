'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA } = require('../../../teaching/d09/tpf10-provider-schema');
const { createExecutionRequest } = require('../../../services/ai/execution-contracts');
const { AI_PROVIDERS } = require('../../../services/ai/providers');
const { serializeGoogleExecutionRequest } = require('../../../services/ai/google-provider-adapter');

test('TPF-10 keeps runtime boolean invariants without sending Gemini boolean enum literals', () => {
  assert.deepEqual(
    TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA.properties.validation_and_handoff.properties.deterministic_scheduler_validation_required,
    { type:'boolean' }
  );
  assert.deepEqual(
    TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA.properties.capacity_analysis.properties.recovery_headroom.properties.invented_numeric_headroom,
    { type:'boolean' }
  );

  const request = createExecutionRequest({
    provider: AI_PROVIDERS.GOOGLE,
    modelId: 'synthetic-google-model',
    content: 'estimate instructional load',
    generation: {
      structuredOutput: {
        mimeType: 'application/json',
        schema: TPF10_INSTRUCTIONAL_LOAD_RESPONSE_SCHEMA,
      },
    },
  });
  const serialized = serializeGoogleExecutionRequest(request);
  const providerSchema = JSON.stringify(serialized.generationConfig.responseSchema);

  assert.doesNotMatch(providerSchema, /"enum":\[(?:true|false)\]/);
  assert.equal(
    serialized.generationConfig.responseSchema.properties.validation_and_handoff.properties.deterministic_scheduler_validation_required.type,
    'boolean'
  );
});
