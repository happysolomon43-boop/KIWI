'use strict';

const { TEACHING_EVENT_NAMES } = require('./names');
const { assertAcademicTimestamp } = require('../domain/time');

const TRIGGER_TYPES = Object.freeze([
  'authenticated_student_input',
  'system_time',
  'committed_domain_event',
  'background_analysis',
  'workflow_continuation',
]);

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function validateTeachingEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Teaching event must be an object.');
  }

  const eventType = requireString(event.eventType, 'eventType');
  if (!TEACHING_EVENT_NAMES.includes(eventType)) {
    throw new TypeError(`Unsupported Teaching event type: ${eventType}`);
  }

  const triggerType = requireString(event.triggerType, 'triggerType');
  if (!TRIGGER_TYPES.includes(triggerType)) {
    throw new TypeError(`Unsupported Teaching trigger type: ${triggerType}`);
  }

  const normalized = {
    eventId: requireString(event.eventId, 'eventId'),
    eventType,
    triggerType,
    source: requireString(event.source, 'source'),
    actorId: event.actorId == null ? null : requireString(event.actorId, 'actorId'),
    aggregateType: event.aggregateType == null ? null : requireString(event.aggregateType, 'aggregateType'),
    aggregateId: event.aggregateId == null ? null : requireString(event.aggregateId, 'aggregateId'),
    aggregateVersion: event.aggregateVersion == null ? null : Number(event.aggregateVersion),
    occurredAt: assertAcademicTimestamp(event.occurredAt, 'occurredAt'),
    effectiveAt: event.effectiveAt == null ? null : assertAcademicTimestamp(event.effectiveAt, 'effectiveAt'),
    dueAt: event.dueAt == null ? null : assertAcademicTimestamp(event.dueAt, 'dueAt'),
    correlationId: event.correlationId == null ? null : requireString(event.correlationId, 'correlationId'),
    causationId: event.causationId == null ? null : requireString(event.causationId, 'causationId'),
    idempotencyKey: event.idempotencyKey == null ? null : requireString(event.idempotencyKey, 'idempotencyKey'),
    payload: event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? Object.freeze({ ...event.payload })
      : Object.freeze({}),
    auditRefs: Array.isArray(event.auditRefs) ? Object.freeze([...event.auditRefs]) : Object.freeze([]),
  };

  if (normalized.aggregateVersion != null && (!Number.isInteger(normalized.aggregateVersion) || normalized.aggregateVersion < 0)) {
    throw new TypeError('aggregateVersion must be a non-negative integer when provided.');
  }

  return Object.freeze(normalized);
}

module.exports = { TRIGGER_TYPES, validateTeachingEvent };
