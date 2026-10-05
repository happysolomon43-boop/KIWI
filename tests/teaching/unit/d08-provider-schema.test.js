'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { coursePlanRequest } = require('../../../teaching/d08/intelligence');
const { TPF03_COURSE_PLAN_RESPONSE_SCHEMA } = require('../../../teaching/d08/tpf03-provider-schema');
const { createExecutionRequest } = require('../../../services/ai/execution-contracts');
const { serializeGoogleExecutionRequest } = require('../../../services/ai/google-provider-adapter');

function minimalCoursePlanArgs() {
  return {
    course: {
      course_id: 'course-1',
      student_id: 'student-1',
      state_version: 7,
      lifecycle_state: 'DRAFT',
      subject_snapshot_ref: 'subject-snapshot:v7',
    },
    audit: {
      curriculum_audit_id: 'audit-1',
      audit_version: 3,
      subject_snapshot_ref: 'subject-snapshot:v7',
      audit_output: {
        topics: [],
        learning_units: [],
        dependencies: [],
        source_accounting: [],
        assumed_prerequisites: [],
      },
    },
    diagnosticPlan: null,
    vpkDecisions: [],
    sources: [],
  };
}

test('TPF-03 Course Plan request carries the frozen structured response schema into neutral generation controls', () => {
  const request = coursePlanRequest(minimalCoursePlanArgs());

  assert.equal(request.generation.maxOutputTokens, 48_000);
  assert.deepEqual(request.generation.structuredOutput.schema, TPF03_COURSE_PLAN_RESPONSE_SCHEMA);
  assert.equal(request.generation.structuredOutput.schema.type, 'object');
  assert.ok(request.generation.structuredOutput.schema.required.includes('course_sequence'));
  assert.ok(request.generation.structuredOutput.schema.required.includes('coverage_treatment_map'));
  assert.deepEqual(
    request.generation.structuredOutput.schema.properties.coverage_treatment_map.items.properties.coverage_status_claimed.enum,
    ['planned_only']
  );
});

test('TPF-03 provider schema mirrors the frozen nested planning artifacts instead of generic objects', () => {
  const properties = TPF03_COURSE_PLAN_RESPONSE_SCHEMA.properties;

  assert.deepEqual(
    Object.keys(properties.prerequisite_repairs.items.properties).sort(),
    ['blocks_units', 'prerequisite_ref', 'repair_goal', 'why_required'].sort()
  );
  assert.deepEqual(
    properties.assessment_window_proposals.items.properties.purpose.enum,
    ['diagnostic', 'classwork', 'test', 'midterm', 'final', 'other']
  );
  assert.deepEqual(
    properties.infeasibility_or_pressure.items.properties.requires_downstream_decision.enum,
    ['scheduling', 'deadline', 'scope_authority', 'other']
  );
  assert.deepEqual(
    properties.course_sequence.items.properties.learning_units.items.properties.follow_up_treatments.items.enum,
    ['review_retrieval', 'mixed_practice', 'synthesis', 'transfer_check', 'none']
  );
});

test('central Google adapter converts the neutral TPF-03 schema to Gemini responseSchema', () => {
  const request = createExecutionRequest({
    provider: 'GOOGLE',
    modelId: 'gemini-3.5-flash-lite',
    taskId: 'MAIN_CBT',
    content: 'Return the requested Course Plan artifact.',
    generation: {
      maxOutputTokens: 48_000,
      structuredOutput: {
        mimeType: 'application/json',
        schema: TPF03_COURSE_PLAN_RESPONSE_SCHEMA,
      },
    },
  });

  const serialized = serializeGoogleExecutionRequest(request);
  assert.equal(serialized.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(serialized.generationConfig.responseSchema, TPF03_COURSE_PLAN_RESPONSE_SCHEMA);
  assert.equal(serialized.generationConfig.maxOutputTokens, 48_000);
  assert.equal(Object.hasOwn(serialized.generationConfig, 'structuredOutput'), false);
});
