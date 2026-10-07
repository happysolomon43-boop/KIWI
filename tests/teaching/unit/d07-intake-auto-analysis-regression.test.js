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
        return { event: { ...event, event_id: event.eventId, status: 'PENDING' } };
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
  assert.equal(events[0].idempotencyKey, 'd07:curriculum-audit:course-1:1:tpf02:1.2');
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

test('a stale active curriculum-audit event is replaced with one bound to the current Course state', async () => {
  const events = [];
  const setup = {
    course: { course_id: 'course-1', state_version: 2 },
    sources: [{ source_content_item_id: 'source-1', source_ref: 'ref-1', content_hash: 'hash-1' }],
    curriculumAudit: null,
    backgroundAnalysis: { event_id: 'stale-event', status: 'CLAIMED' },
  };
  const service = createD07Service({
    subjects: subjects(),
    repository: { async getSetup() { return setup; } },
    intelligence: {},
    outboxStore: {
      async getById() {
        return { event_id: 'stale-event', status: 'CLAIMED', aggregate_version: 1 };
      },
      async append(event) {
        events.push(event);
        return { event: { ...event, event_id: event.eventId, status: 'PENDING' } };
      },
    },
    randomUUID: () => 'replacement-event',
    clock: () => new Date('2026-10-06T10:00:00.000Z'),
    logger: { warn() {} },
  });

  const reconciled = await service.getSetup({ id: 'student-1' }, 'course-1');

  assert.equal(events.length, 1);
  assert.equal(events[0].aggregateVersion, 2);
  assert.equal(events[0].payload.expected_state_version, '2');
  assert.equal(events[0].causationId, 'stale-event');
  assert.equal(events[0].idempotencyKey, 'd07:curriculum-audit:course-1:2:tpf02:1.2:state-recovery:stale-event');
  assert.equal(reconciled.backgroundAnalysis.event_id, 'replacement-event');
  assert.equal(reconciled.backgroundAnalysis.status, 'PENDING');
  assert.equal(reconciled.backgroundAnalysis.recovery_reason, 'COURSE_STATE_CHANGED');
});

test('PUBLISHED without a Curriculum Audit artifact is treated as recoverable, not successful analysis', async () => {
  const events = [];
  const setup = {
    course: { course_id: 'course-1', state_version: 2 },
    sources: [{ source_content_item_id: 'source-1', source_ref: 'ref-1', content_hash: 'hash-1' }],
    curriculumAudit: null,
    backgroundAnalysis: { event_id: 'published-without-audit', status: 'PUBLISHED', last_error_code: 'TIMEOUT' },
  };
  const service = createD07Service({
    subjects: subjects(),
    repository: { async getSetup() { return setup; } },
    intelligence: {},
    outboxStore: {
      async getById() {
        return { event_id: 'published-without-audit', status: 'PUBLISHED', aggregate_version: 2 };
      },
      async append(event) {
        events.push(event);
        return { event: { ...event, event_id: event.eventId, status: 'PENDING' } };
      },
    },
    randomUUID: () => 'recovery-event',
    clock: () => new Date('2026-10-06T10:00:00.000Z'),
    logger: { warn() {} },
  });

  const reconciled = await service.getSetup({ id: 'student-1' }, 'course-1');

  assert.equal(events.length, 1);
  assert.equal(events[0].aggregateVersion, 2);
  assert.equal(events[0].idempotencyKey, 'd07:curriculum-audit:course-1:2:tpf02:1.2:state-recovery:published-without-audit');
  assert.equal(reconciled.backgroundAnalysis.status, 'PENDING');
  assert.equal(reconciled.backgroundAnalysis.last_error_code, null);
  assert.equal(reconciled.backgroundAnalysis.recovery_reason, 'PUBLISHED_WITHOUT_AUDIT');
});

test('a Course mutation during a long Curriculum Audit prevents stale artifact persistence', async () => {
  let reads = 0;
  let saved = false;
  const sources = [{ source_content_item_id: 'source-1', source_ref: 'ref-1', content_hash: 'hash-1' }];
  const repository = {
    async getSetup() {
      reads += 1;
      return {
        course: {
          course_id: 'course-1',
          state_version: reads === 1 ? 1 : 2,
          subject_snapshot_ref: 'subject:1',
        },
        sources,
      };
    },
    async saveAudit() {
      saved = true;
      return {};
    },
  };
  const service = createD07Service({
    subjects: subjects(),
    repository,
    intelligence: {
      async runCurriculumAudit() {
        return { accepted: true, validatedResult: { output: {} } };
      },
    },
  });

  await assert.rejects(
    service.runAudit({ id: 'student-1' }, 'course-1'),
    (error) => error?.code === 'TEACHING_D07_AUDIT_STATE_CHANGED' && error?.retryable === true
  );
  assert.equal(saved, false);
  assert.equal(reads, 2);
});

test('successful outbox publication clears stale retry metadata and claim ownership', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../teaching/runtime/postgres-outbox-store.js'),
    'utf8'
  );
  assert.match(source, /status='PUBLISHED',published_at=now\(\),last_error_code=null/);
  assert.match(source, /claim_token=null,claimed_by=null,claimed_at=null,claim_expires_at=null/);
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
