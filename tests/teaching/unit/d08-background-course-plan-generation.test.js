'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createD08Service } = require('../../../teaching/d08/service');
const { TEACHING_EVENT_NAMES } = require('../../../teaching/events/names');

function readySetup(backgroundPlanGeneration = null) {
  return {
    course: {
      course_id: 'course-1',
      student_id: 'student-1',
      subject_id: 'subject-1',
      title: 'GST',
      lifecycle_state: 'DRAFT',
      state_version: 7,
      subject_snapshot_ref: 'subject:subject-1:snapshot-7',
    },
    curriculumAudit: {
      curriculum_audit_id: 'audit-1',
      status: 'VALIDATED_CANDIDATE',
      subject_snapshot_ref: 'subject:subject-1:snapshot-7',
      source_inventory_digest: 'digest-1',
      audit_output: { topics: [], learning_units: [], assumed_prerequisites: [] },
    },
    diagnosticPlan: null,
    vpkDecisions: [],
    sources: [{
      source_content_item_id: 'source-1',
      source_ref: 'source-ref-1',
      classification: 'ACADEMICALLY_MEANINGFUL',
      academically_meaningful: true,
    }],
    plan: null,
    topics: [],
    subtopics: [],
    learningUnits: [],
    dependencies: [],
    assumedPrerequisites: [],
    coverageMappings: [],
    coverage: [],
    coverageAudits: [],
    scopeChanges: [],
    backgroundPlanGeneration,
  };
}

function service({ setup = readySetup(), append } = {}) {
  const repository = {
    getPlanReview: async () => setup,
  };
  return createD08Service({
    subjects: { getCorpusForUser: async () => ({}) },
    repository,
    intelligence: { generateCoursePlan: async () => ({ accepted: true }) },
    outboxStore: { append },
    randomUUID: () => 'event-1',
    clock: () => new Date('2026-10-06T22:00:00.000Z'),
  });
}

test('Course Plan background event is part of the governed Teaching event vocabulary', () => {
  assert.ok(TEACHING_EVENT_NAMES.includes('teaching.course_plan.generation_requested'));
});

test('queueCoursePlan returns immediately after appending one bounded durable generation event', async () => {
  let appended = null;
  const d08 = service({
    append: async (event) => {
      appended = event;
      return {
        inserted: true,
        event: { event_id: event.eventId, status: 'PENDING' },
      };
    },
  });

  const result = await d08.queueCoursePlan({ id: 'student-1' }, 'course-1');

  assert.equal(result.accepted, true);
  assert.equal(result.background, true);
  assert.equal(result.status, 'PENDING');
  assert.equal(appended.eventType, 'teaching.course_plan.generation_requested');
  assert.equal(appended.triggerType, 'background_analysis');
  assert.equal(appended.aggregateId, 'course-1');
  assert.equal(appended.aggregateVersion, 7);
  assert.equal(appended.payload.expected_state_version, '7');
  assert.deepEqual(appended.auditRefs, ['curriculum-audit:audit-1']);
  assert.deepEqual(appended.provenanceRefs, ['source:source-1']);
});

test('queueCoursePlan joins an existing active durable job instead of launching duplicate model work', async () => {
  let appendCalls = 0;
  const d08 = service({
    setup: readySetup({
      event_id: 'existing-job',
      status: 'CLAIMED',
      attempt_count: 1,
      last_error_code: null,
    }),
    append: async () => {
      appendCalls += 1;
      throw new Error('should not append');
    },
  });

  const result = await d08.queueCoursePlan({ id: 'student-1' }, 'course-1');

  assert.equal(result.jobId, 'existing-job');
  assert.equal(result.joinedExisting, true);
  assert.equal(appendCalls, 0);
});

test('cancelled Course Plan generation gets a causally linked recovery event', async () => {
  let appended = null;
  const d08 = service({
    setup: readySetup({
      event_id: 'failed-job',
      status: 'CANCELLED',
      attempt_count: 2,
      last_error_code: 'TEACHING_D08_COURSE_PLAN_REJECTED',
    }),
    append: async (event) => {
      appended = event;
      return {
        inserted: true,
        event: { event_id: event.eventId, status: 'PENDING' },
      };
    },
  });

  await d08.queueCoursePlan({ id: 'student-1' }, 'course-1');

  assert.equal(appended.causationId, 'failed-job');
  assert.match(appended.idempotencyKey, /:recovery:failed-job$/);
});
