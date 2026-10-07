'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TEACHING_EVENTS, TEACHING_EVENT_NAMES } = require('../../../teaching/events/names');
const { createTeachingEventSubscriberRegistry } = require('../../../teaching/events/dispatcher');
const { validateTeachingEvent } = require('../../../teaching/events/contracts');

test('durable timetable build is a registered Teaching event before backend subscribers initialize', () => {
  assert.equal(TEACHING_EVENTS.TIMETABLE_BUILD_REQUESTED, 'teaching.timetable.build_requested');
  assert.ok(TEACHING_EVENT_NAMES.includes(TEACHING_EVENTS.TIMETABLE_BUILD_REQUESTED));

  const registry = createTeachingEventSubscriberRegistry();
  assert.doesNotThrow(() => registry.register(TEACHING_EVENTS.TIMETABLE_BUILD_REQUESTED, {
    subscriberId: 'test-timetable-worker',
    handle: async () => ({ accepted: true }),
  }));

  const event = validateTeachingEvent({
    eventId: 'event-1',
    schemaVersion: 1,
    eventType: TEACHING_EVENTS.TIMETABLE_BUILD_REQUESTED,
    eventCategory: 'operational_recovery_event',
    triggerType: 'background_analysis',
    source: 'teaching.d09',
    origin: 'teaching.schedule_manual_build',
    actorId: 'student-1',
    aggregateType: 'teaching_course',
    aggregateId: 'course-1',
    aggregateVersion: 1,
    occurredAt: '2026-10-07T15:00:00.000Z',
    correlationId: 'event-1',
    idempotencyKey: 'd09:test',
    payload: { semester_id: 'semester-1', operation: 'BUILD' },
    auditRefs: [],
    provenanceRefs: [],
  });
  assert.equal(event.eventType, TEACHING_EVENTS.TIMETABLE_BUILD_REQUESTED);
});
