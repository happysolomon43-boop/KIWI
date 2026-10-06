'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createD07Service } = require('../../../teaching/d07/service');
const { createPostgresTeachingOutboxStore } = require('../../../teaching/runtime/postgres-outbox-store');

function subjectSource() {
  return {
    async getForUser() { return { id: 'subject-1', name: 'Physics' }; },
    async getCorpusForUser() { return { subject: { id: 'subject-1' }, decks: [], cards: [] }; },
  };
}

function setup({ stateVersion = 2, backgroundStatus = 'PUBLISHED', audit = null } = {}) {
  return {
    course: {
      course_id: 'course-1',
      state_version: stateVersion,
      subject_snapshot_ref: 'subject:subject-1:snapshot-1',
    },
    sources: [{
      source_content_item_id: 'source-1',
      source_ref: 'card:1:front',
      content_hash: 'hash-1',
    }],
    curriculumAudit: audit,
    backgroundAnalysis: {
      event_id: 'event-1',
      status: backgroundStatus,
      attempt_count: 3,
      last_error_code: 'TIMEOUT',
    },
  };
}

test('D07 setup read-repair replaces a stale published event that produced no audit artifact', async () => {
  const appended = [];
  const repository = {
    async getSetup() { return setup(); },
  };
  const outboxStore = {
    async getById() {
      return {
        event_id: 'event-1',
        status: 'PUBLISHED',
        aggregate_version: 1,
      };
    },
    async append(event) {
      appended.push(event);
      return { event: { event_id: event.eventId, status: 'PENDING' } };
    },
  };
  const service = createD07Service({
    subjects: subjectSource(),
    repository,
    intelligence: {},
    outboxStore,
    randomUUID: () => 'event-2',
    clock: () => new Date('2026-10-06T10:15:00.000Z'),
    logger: { warn() {} },
  });

  const result = await service.getSetup({ id: 'student-1' }, 'course-1');

  assert.equal(appended.length, 1);
  assert.equal(appended[0].eventId, 'event-2');
  assert.equal(appended[0].aggregateVersion, 2);
  assert.equal(appended[0].causationId, 'event-1');
  assert.equal(appended[0].payload.expected_state_version, '2');
  assert.equal(appended[0].idempotencyKey, 'd07:curriculum-audit:course-1:2:state-recovery:event-1');
  assert.equal(result.backgroundAnalysis.event_id, 'event-2');
  assert.equal(result.backgroundAnalysis.status, 'PENDING');
  assert.equal(result.backgroundAnalysis.last_error_code, null);
  assert.equal(result.backgroundAnalysis.recovered_from_event_id, 'event-1');
});

test('D07 does not persist an AI audit generated against a superseded course snapshot', async () => {
  let setupReads = 0;
  let saved = false;
  const repository = {
    async getSetup() {
      setupReads += 1;
      return setup({ stateVersion: setupReads === 1 ? 1 : 2, backgroundStatus: 'CLAIMED' });
    },
    async saveAudit() {
      saved = true;
      return { curriculum_audit_id: 'audit-1' };
    },
  };
  const service = createD07Service({
    subjects: subjectSource(),
    repository,
    intelligence: {
      async runCurriculumAudit() {
        return {
          accepted: true,
          validatedResult: { output: { status: 'READY' } },
        };
      },
    },
  });

  await assert.rejects(
    () => service.runAudit({ id: 'student-1' }, 'course-1'),
    (error) => error?.code === 'TEACHING_D07_AUDIT_STATE_CHANGED' && error?.retryable === true
  );
  assert.equal(saved, false);
});

test('published outbox events clear stale retry errors and claim ownership metadata', async () => {
  let capturedSql = '';
  let capturedParams = null;
  const store = createPostgresTeachingOutboxStore({
    randomUUID: () => 'uuid-1',
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{ event_id: 'event-1', status: 'PUBLISHED', last_error_code: null }] };
    },
  });

  const row = await store.markPublished({ event_id: 'event-1', claim_token: 'claim-1' });

  assert.equal(row.status, 'PUBLISHED');
  assert.match(capturedSql, /last_error_code=null/);
  assert.match(capturedSql, /claim_token=null/);
  assert.match(capturedSql, /claimed_by=null/);
  assert.match(capturedSql, /claimed_at=null/);
  assert.deepEqual(capturedParams, ['event-1', 'claim-1']);
});
