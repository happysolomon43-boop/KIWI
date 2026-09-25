'use strict';

const { TEACHING_EVENT_NAMES } = require('./names');
const { assertAcademicTimestamp } = require('../domain/time');
const {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_VALUES,
} = require('../runtime/constants');

const TRIGGER_TYPES = Object.freeze([
  'authenticated_student_input',
  'system_time',
  'committed_domain_event',
  'background_analysis',
  'workflow_continuation',
]);

const DEFAULT_CATEGORY_BY_TRIGGER = Object.freeze({
  authenticated_student_input: EVENT_CATEGORIES.AUTHENTICATED_COMMAND,
  system_time: EVENT_CATEGORIES.SCHEDULED_DUE_EVENT,
  committed_domain_event: EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
  background_analysis: EVENT_CATEGORIES.OPERATIONAL_RECOVERY_EVENT,
  workflow_continuation: EVENT_CATEGORIES.OPERATIONAL_RECOVERY_EVENT,
});

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeRefs(value, field) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  return Object.freeze(value.map((item) => requireString(item, field)));
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

  const schemaVersion = event.schemaVersion == null ? 1 : Number(event.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new TypeError('schemaVersion must be a positive integer.');
  }

  const inferredCategory = DEFAULT_CATEGORY_BY_TRIGGER[triggerType];
  const eventCategory = event.eventCategory == null
    ? inferredCategory
    : requireString(event.eventCategory, 'eventCategory');

  if (!EVENT_CATEGORY_VALUES.includes(eventCategory)) {
    throw new TypeError(`Unsupported Teaching event category: ${eventCategory}`);
  }

  // Hard authority distinctions: browser/student input, durable system time and
  // committed domain facts cannot masquerade as a different event category.
  if (
    triggerType === 'authenticated_student_input' &&
    eventCategory !== EVENT_CATEGORIES.AUTHENTICATED_COMMAND
  ) {
    throw new TypeError('Authenticated student input cannot masquerade as an authoritative event.');
  }
  if (
    triggerType === 'system_time' &&
    eventCategory !== EVENT_CATEGORIES.SCHEDULED_DUE_EVENT
  ) {
    throw new TypeError('System-time triggers must be scheduled_due_event events.');
  }
  if (
    triggerType === 'committed_domain_event' &&
    eventCategory !== EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT
  ) {
    throw new TypeError('Committed domain events cannot be reclassified as another authority type.');
  }

  const source = requireString(event.source, 'source');
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? Object.freeze({ ...event.payload })
    : Object.freeze({});

  // D02 event payloads are routing context, not an alternate academic state
  // store. Keep them bounded so large source/student content cannot be smuggled
  // into the event substrate.
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 65_536) {
    throw new TypeError('Teaching event payload exceeds the 64 KiB routing-payload limit.');
  }

  const normalized = {
    eventId: requireString(event.eventId, 'eventId'),
    schemaVersion,
    eventType,
    eventCategory,
    triggerType,
    source,
    origin: event.origin == null ? source : requireString(event.origin, 'origin'),
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
    payload,
    auditRefs: normalizeRefs(event.auditRefs, 'auditRefs'),
    provenanceRefs: normalizeRefs(event.provenanceRefs, 'provenanceRefs'),
  };

  if (normalized.aggregateVersion != null && (!Number.isInteger(normalized.aggregateVersion) || normalized.aggregateVersion < 0)) {
    throw new TypeError('aggregateVersion must be a non-negative integer when provided.');
  }

  return Object.freeze(normalized);
}

module.exports = {
  TRIGGER_TYPES,
  DEFAULT_CATEGORY_BY_TRIGGER,
  validateTeachingEvent,
};
