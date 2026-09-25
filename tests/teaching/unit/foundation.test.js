'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTeachingConfig } = require('../../../teaching/config');
const ids = require('../../../teaching/domain/ids');
const time = require('../../../teaching/domain/time');
const { TEACHING_EVENTS, TEACHING_EVENT_NAMES } = require('../../../teaching/events/names');
const { validateTeachingEvent } = require('../../../teaching/events/contracts');
const { createTeachingEventDispatcher } = require('../../../teaching/events/dispatcher');
const {
  createInMemoryIdempotencyStore,
  createIdempotentHandler,
} = require('../../../teaching/events/idempotency');
const { createAuditEvent } = require('../../../teaching/events/audit');
const { createKiwiSubjectReader } = require('../../../teaching/integrations/kiwi-subjects');
const { createKiwiExamInterface } = require('../../../teaching/integrations/kiwi-exam-interface');
const {
  PRIVILEGED_TEACHING_OPERATIONS,
  assertServerPrivilegeBoundary,
} = require('../../../teaching/security/privileged-operations');
const { auditSourceText } = require('../../../teaching/security/secret-audit');
const { modules } = require('../../../teaching/modules');

test('Teaching configuration has no runtime feature-availability toggle layer', () => {
  const config = createTeachingConfig({
    TEACHING_ENABLED: 'false',
    TEACHING_DEV_USER_IDS: 'dev-1',
    TEACHING_HIGH_STAKES_MARKING_ENABLED: 'false',
    TEACHING_IMPROMPTU_TESTS_ENABLED: 'false',
    TEACHING_RESITS_ENABLED: 'false',
    TEACHING_EXTERNAL_INTEGRATIONS_ENABLED: 'false',
  });

  assert.equal(Object.hasOwn(config, 'featureFlags'), false);
  assert.equal(Object.hasOwn(config, 'flags'), false);
});

test('Teaching config exposes an opaque AI routing seam without provider defaults', () => {
  const config = createTeachingConfig({});
  assert.equal(config.ai.routingOwner, 'kiwi-ai-orchestrator');
  assert.equal(config.ai.providerSetting, null);
  assert.equal(config.ai.modelSetting, null);
  assert.equal(config.ai.timeoutMs, 45000);
  assert.equal(config.ai.tokenBudget, 8192);
});

test('all canonical D01 domain identifier constructors reject invalid values', () => {
  assert.equal(ids.ID_KINDS.length, 14);
  assert.equal(ids.asCourseId('course-1'), 'course-1');
  assert.equal(ids.asAttendanceRecordId('attendance:1'), 'attendance:1');
  assert.throws(() => ids.asCourseId(''), /course id/);
  assert.throws(() => ids.assertDomainId('not-a-kind', 'x'), /Unknown Teaching identifier/);
});

test('academic timestamps require timezone information', () => {
  assert.equal(time.assertAcademicTimestamp('2026-09-25T12:30:00Z'), '2026-09-25T12:30:00Z');
  assert.equal(time.assertAcademicTimestamp('2026-09-25T13:30:00+01:00'), '2026-09-25T13:30:00+01:00');
  assert.throws(() => time.assertAcademicTimestamp('2026-09-25T12:30:00'), /explicit UTC offset/);
});

test('D01 defines every required initial Teaching event name', () => {
  assert.equal(TEACHING_EVENT_NAMES.length, 13);
  for (const key of [
    'COURSE_ACTIVATED','CLASS_START_DUE','CLASS_JOINED','STUDENT_RESPONSE_SUBMITTED',
    'ACTIVITY_TIMER_EXPIRED','BREAK_STARTED','BREAK_ENDED','ASSESSMENT_STARTED',
    'ASSESSMENT_SUBMITTED','CLASS_ENDED','ASSIGNMENT_DUE','REQUEST_DECIDED','COURSE_RISK_CHANGED',
  ]) assert.ok(TEACHING_EVENTS[key]);
});

test('Teaching event dispatcher validates contracts before publishing', async () => {
  const published = [];
  const dispatcher = createTeachingEventDispatcher({ publish: async (event) => published.push(event) });
  await dispatcher.dispatch({
    eventId: 'event-1',
    eventType: TEACHING_EVENTS.CLASS_JOINED,
    triggerType: 'authenticated_student_input',
    source: 'classroom',
    actorId: 'student-1',
    occurredAt: '2026-09-25T12:30:00Z',
    idempotencyKey: 'join:1',
    payload: { classId: 'class-1' },
  });
  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, TEACHING_EVENTS.CLASS_JOINED);
});

test('idempotency abstraction suppresses duplicate handler execution', async () => {
  const store = createInMemoryIdempotencyStore();
  let calls = 0;
  const handler = createIdempotentHandler({
    store,
    handler: async (value) => { calls += 1; return value * 2; },
  });

  assert.deepEqual(await handler('key-1', 4), { replay: false, result: 8 });
  assert.deepEqual(await handler('key-1', 999), { replay: true, result: 8 });
  assert.equal(calls, 1);
});

test('audit-event abstraction is structured and timezone-aware', () => {
  const event = createAuditEvent({
    auditId: 'audit-1',
    action: 'foundation.test',
    actorId: 'user-1',
    entityType: 'course',
    entityId: 'course-1',
    occurredAt: '2026-09-25T12:30:00Z',
  });
  assert.equal(event.entityId, 'course-1');
  assert.ok(Object.isFrozen(event));
});

test('Subject integration is always scoped through the authenticated user list', async () => {
  const calls = [];
  const reader = createKiwiSubjectReader({
    subjects: {
      async findManyWithDecks(userId) {
        calls.push(userId);
        return [{ id: 'subject-a', user_id: userId }];
      },
      async findById() {
        throw new Error('unscoped findById must never be called');
      },
    },
  });
  assert.equal((await reader.getForUser('user-a', 'subject-a')).id, 'subject-a');
  assert.deepEqual(calls, ['user-a']);
});

test('KIWI Exam integration points at existing CBT technology without implementing assessment rules', () => {
  const exam = createKiwiExamInterface();
  assert.equal(exam.owner, 'kiwi-exam');
  assert.equal(exam.configurationRoute, 'exam-config');
  assert.equal(exam.activeExamRoute, 'exam');
  assert.equal(exam.buildHandoff({ subjectId: 's1' }).targetRoute, 'exam-config');
});

test('privileged academic operations fail closed outside the server trust boundary', () => {
  assert.deepEqual(PRIVILEGED_TEACHING_OPERATIONS, [
    'grading.finalize',
    'assessment.package.lock',
    'request.formal.decide',
    'schedule.authority.update',
  ]);
  assert.throws(
    () => assertServerPrivilegeBoundary('grading.finalize', { trustBoundary: 'browser' }),
    /cannot trust the browser/
  );
  assert.equal(
    assertServerPrivilegeBoundary('grading.finalize', { trustBoundary: 'server' }),
    true
  );
});

test('canonical Teaching module package boundaries exist without academic behavior', () => {
  assert.deepEqual(Object.keys(modules).sort(), [
    'assessment','attendance','classroom','controller','courses','curriculum','grading',
    'knowledge','lessons','pedagogy','progression','requests','scheduling','sharedUi',
    'teacherIdentity','work',
  ].sort());
  for (const descriptor of Object.values(modules)) {
    assert.equal(descriptor.status, 'foundation-only');
    assert.equal(descriptor.authority, 'none-d01-foundation');
  }
});

test('secret audit detects credential literals and provider SDK imports', () => {
  assert.ok(auditSourceText("const x = 'postgresql://user:pass@example/db'", 'x.js').length > 0);
  assert.ok(auditSourceText("const t = process.env.ADMIN_TOKEN || 'bad-token'", 'x.js').length > 0);
  assert.ok(auditSourceText("const sdk = require('@google/generative-ai')", 'x.js').length > 0);
});

test('Teaching source tree contains no secret fallback or provider SDK import findings', () => {
  const root = path.resolve(__dirname, '../../..');
  const scanRoots = [
    path.join(root, 'teaching'),
    path.join(root, 'teaching-backend.js'),
    path.join(root, 'public', 'teaching.js'),
    path.join(root, 'index.js'),
  ];

  const findings = [];
  function scan(file) {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(file)) scan(path.join(file, child));
      return;
    }
    if (!/\.(?:js|mjs|cjs)$/.test(file)) return;
    findings.push(...auditSourceText(fs.readFileSync(file, 'utf8'), path.relative(root, file)));
  }

  for (const scanRoot of scanRoots) scan(scanRoot);
  assert.deepEqual(findings, []);
});
