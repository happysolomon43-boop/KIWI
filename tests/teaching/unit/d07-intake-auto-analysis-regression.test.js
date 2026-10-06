'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { intakeRequest } = require('../../../teaching/d07/intelligence');
const { createD07Service } = require('../../../teaching/d07/service');

const corpus = {
  subject: { id: 'subject-1', user_id: 'student-1', name: 'Mathematics', updated_at: 'v1' },
  decks: [{ id: 'deck-1', name: 'Algebra' }],
  cards: [{
    id: 'card-1',
    deck_id: 'deck-1',
    front_content: 'Solve x + 2 = 5',
    back_content: 'x = 3',
  }],
};

function subjects() {
  return {
    async getForUser(userId, subjectId) {
      return userId === 'student-1' && subjectId === 'subject-1' ? corpus.subject : null;
    },
    async getCorpusForUser() {
      return corpus;
    },
  };
}

test('D07 student intake declares every uncertainty state required by the structural prompt contract', () => {
  const request = intakeRequest({
    course: {
      course_id: 'course-1',
      student_id: 'student-1',
      state_version: 1,
      lifecycle_state: 'DRAFT',
    },
    intake: { intake_id: 'intake-1' },
  });

  for (const state of ['INSUFFICIENT_EVIDENCE', 'UNRESOLVED_CONFLICT', 'REVIEW_NEEDED']) {
    assert.ok(request.outputSchema.uncertainty_states.includes(state), `missing ${state}`);
  }
});

test('new Teaching courses enqueue curriculum analysis immediately after the durable source inventory is saved', async () => {
  const order = [];
  const events = [];
  const repository = {
    async createDraft() {
      order.push('draft-saved');
      return { course_id: 'course-1', subject_id: 'subject-1', lifecycle_state: 'DRAFT' };
    },
    async getSetup() {
      order.push('setup-read');
      return {
        course: { course_id: 'course-1', state_version: 1 },
        sources: [{ source_content_item_id: 'source-1' }],
        backgroundAnalysis: null,
      };
    },
  };
  const service = createD07Service({
    subjects: subjects(),
    repository,
    intelligence: {},
    outboxStore: {
      async append(event) {
        order.push('audit-enqueued');
        events.push(event);
        return { event: { ...event, status: 'PENDING' } };
      },
    },
    randomUUID: () => 'job-1',
    clock: () => new Date('2026-10-06T09:00:00.000Z'),
    logger: { warn() {} },
  });

  const course = await service.createCourse({ id: 'student-1' }, { subjectId: 'subject-1' });

  assert.deepEqual(order, ['draft-saved', 'setup-read', 'audit-enqueued']);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'teaching.curriculum.audit_requested');
  assert.equal(events[0].idempotencyKey, 'd07:curriculum-audit:course-1:1');
  assert.equal(course.background_analysis.status, 'PENDING');
});

test('an analysis enqueue failure never rolls back or hides an already-saved course draft', async () => {
  let saved = false;
  const repository = {
    async createDraft() {
      saved = true;
      return { course_id: 'course-1', subject_id: 'subject-1', lifecycle_state: 'DRAFT' };
    },
    async getSetup() {
      return {
        course: { course_id: 'course-1', state_version: 1 },
        sources: [{ source_content_item_id: 'source-1' }],
        backgroundAnalysis: null,
      };
    },
  };
  const service = createD07Service({
    subjects: subjects(),
    repository,
    intelligence: {},
    outboxStore: {
      async append() {
        const error = new Error('temporary outbox failure');
        error.code = 'OUTBOX_TEMPORARY_FAILURE';
        throw error;
      },
    },
    randomUUID: () => 'job-1',
    logger: { warn() {} },
  });

  const course = await service.createCourse({ id: 'student-1' }, { subjectId: 'subject-1' });

  assert.equal(saved, true);
  assert.equal(course.course_id, 'course-1');
  assert.equal(course.background_analysis.accepted, false);
  assert.equal(course.background_analysis.status, 'QUEUE_FAILED');
  assert.equal(course.background_analysis.code, 'OUTBOX_TEMPORARY_FAILURE');
});

test('the unified upload flow persists uploaded sources before it submits optional learning context', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../public/teaching-unified-upload.js'),
    'utf8'
  );

  assert.match(source, /apiRequest\('\/teaching\/courses',[\s\S]*originalMaterials,supplementaryMaterials/);
  assert.match(source, /apiRequest\(`\/teaching\/courses\/\$\{encodeURIComponent\(course\.course_id\)\}\/intake`/);
  assert.doesNotMatch(source, /originalMaterials,supplementaryMaterials,intake:signals\(\)/);
});
