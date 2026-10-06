'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEGACY_TRUNCATION_CODE,
  RECOVERY_REASON,
  decorateTruncationRecovery,
} = require('../../../teaching/d07/truncation-recovery-service');

function cancelledSetup() {
  return {
    course: { course_id: 'course-1', state_version: 2 },
    curriculumAudit: null,
    backgroundAnalysis: {
      event_id: 'event-old',
      status: 'CANCELLED',
      last_error_code: LEGACY_TRUNCATION_CODE,
    },
  };
}

test('D07 automatically migrates one legacy truncation-cancelled audit into current recovery work', async () => {
  const calls = [];
  const service = {
    async getSetup() { return cancelledSetup(); },
    async queueAudit(user, courseId, options) {
      calls.push({ user, courseId, options });
      return { accepted: true, background: true, jobId: 'event-new', status: 'PENDING' };
    },
  };
  const decorated = decorateTruncationRecovery(service, {
    outboxStore: {
      async getById(id) {
        assert.equal(id, 'event-old');
        return {
          event_id: 'event-old',
          status: 'CANCELLED',
          last_error_code: LEGACY_TRUNCATION_CODE,
          causation_id: null,
        };
      },
    },
  });

  const result = await decorated.getSetup({ id: 'student-1' }, 'course-1');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, {
    supersedeEventId: 'event-old',
    causationId: 'event-old',
  });
  assert.equal(result.backgroundAnalysis.event_id, 'event-new');
  assert.equal(result.backgroundAnalysis.status, 'PENDING');
  assert.equal(result.backgroundAnalysis.last_error_code, null);
  assert.equal(result.backgroundAnalysis.recovered_from_event_id, 'event-old');
  assert.equal(result.backgroundAnalysis.recovery_reason, RECOVERY_REASON);
});

test('D07 does not create an automatic retry loop when staged recovery itself truncates', async () => {
  let queueCalls = 0;
  const setup = cancelledSetup();
  setup.backgroundAnalysis.event_id = 'event-recovery';
  const service = {
    async getSetup() { return setup; },
    async queueAudit() { queueCalls += 1; throw new Error('must not run'); },
  };
  const decorated = decorateTruncationRecovery(service, {
    outboxStore: {
      async getById() {
        return {
          event_id: 'event-recovery',
          status: 'CANCELLED',
          last_error_code: LEGACY_TRUNCATION_CODE,
          causation_id: 'event-old',
        };
      },
    },
  });

  const result = await decorated.getSetup({ id: 'student-1' }, 'course-1');
  assert.equal(queueCalls, 0);
  assert.equal(result.backgroundAnalysis.event_id, 'event-recovery');
  assert.equal(result.backgroundAnalysis.status, 'CANCELLED');
});

test('D07 leaves unrelated terminal audit failures terminal', async () => {
  let queueCalls = 0;
  const service = {
    async getSetup() { return cancelledSetup(); },
    async queueAudit() { queueCalls += 1; },
  };
  const decorated = decorateTruncationRecovery(service, {
    outboxStore: {
      async getById() {
        return {
          event_id: 'event-old',
          status: 'CANCELLED',
          last_error_code: 'TEACHING_D07_CURRICULUM_AUDIT_REJECTED',
          causation_id: null,
        };
      },
    },
  });

  const result = await decorated.getSetup({ id: 'student-1' }, 'course-1');
  assert.equal(queueCalls, 0);
  assert.equal(result.backgroundAnalysis.status, 'CANCELLED');
});

test('D07 recovery inspection failure is fail-safe and preserves the original setup', async () => {
  const warnings = [];
  let queueCalls = 0;
  const original = cancelledSetup();
  const service = {
    async getSetup() { return original; },
    async queueAudit() { queueCalls += 1; },
  };
  const decorated = decorateTruncationRecovery(service, {
    outboxStore: {
      async getById() { throw Object.assign(new Error('temporary db issue'), { code: 'DB_TEMP' }); },
    },
    logger: { warn(message, metadata) { warnings.push({ message, metadata }); } },
  });

  const result = await decorated.getSetup({ id: 'student-1' }, 'course-1');
  assert.equal(result, original);
  assert.equal(queueCalls, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].metadata.code, 'DB_TEMP');
});
