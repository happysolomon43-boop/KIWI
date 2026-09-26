'use strict';

const crypto = require('node:crypto');
const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES } = require('../runtime/constants');

const PPL_EVENT_TYPES = Object.freeze([
  TEACHING_EVENTS.PREPARATION_WORKSPACE_SEEDED,
  TEACHING_EVENTS.PREPARATION_INPUT_CHANGED,
  TEACHING_EVENTS.PREPARATION_REVIEW_DUE,
  TEACHING_EVENTS.PREPARATION_FINALIZATION_DUE,
  TEACHING_EVENTS.PREPARATION_FINDING_RESOLVED,
  TEACHING_EVENTS.PROTECTED_CANDIDATE_CONTAMINATED,
  TEACHING_EVENTS.PREPARATION_WORKSPACE_SUPERSEDED,
  TEACHING_EVENTS.PREPARATION_WORKSPACE_CANCELLED,
  TEACHING_EVENTS.PREPARATION_HANDOFF_READY,
]);

const DUE_PPL_EVENTS = Object.freeze(new Set([
  TEACHING_EVENTS.PREPARATION_REVIEW_DUE,
  TEACHING_EVENTS.PREPARATION_FINALIZATION_DUE,
]));

function nonEmpty(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}

function digestRefs(refs) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([...new Set((refs || []).map(String))].sort()))
    .digest('hex')
    .slice(0, 16);
}

function eventIdempotencyScope({ eventId, eventType, dueAt, refs, payload }) {
  if (DUE_PPL_EVENTS.has(eventType)) return String(dueAt);
  if (eventType === TEACHING_EVENTS.PREPARATION_INPUT_CHANGED) return digestRefs(refs);

  const explicit = payload?.idempotency_scope_ref ??
    payload?.finding_ref ??
    payload?.artifact_version_ref ??
    payload?.superseded_by_workspace_ref ??
    payload?.target_ref ??
    null;

  // Non-input PPL facts at the same workspace version are distinct facts.
  // Their durable event identity (or an explicit semantic scope reference)
  // must therefore participate in the idempotency key; otherwise resolving two
  // different findings at the same version would incorrectly deduplicate.
  return explicit == null ? nonEmpty(eventId, 'eventId') : nonEmpty(explicit, 'payload idempotency scope');
}

function buildPreparationEvent({
  eventId,
  eventType,
  workspaceId,
  workspaceVersion,
  occurredAt,
  dueAt = null,
  correlationId,
  causationId = null,
  changedDependencyRefs = [],
  payload = {},
  auditRefs = [],
  provenanceRefs = [],
} = {}) {
  const normalizedEventId = nonEmpty(eventId, 'eventId');
  const normalizedWorkspaceId = nonEmpty(workspaceId, 'workspaceId');
  const normalizedCorrelationId = nonEmpty(correlationId, 'correlationId');
  if (!PPL_EVENT_TYPES.includes(eventType)) {
    throw new TypeError(`Unsupported PPL event type: ${eventType}`);
  }

  const version = Number(workspaceVersion);
  if (!Number.isInteger(version) || version < 0) {
    throw new TypeError('workspaceVersion must be a non-negative integer.');
  }

  const isDue = DUE_PPL_EVENTS.has(eventType);
  if (isDue && !dueAt) throw new TypeError(`${eventType} requires dueAt.`);

  const refs = [...new Set((changedDependencyRefs || []).map(String))].sort();
  const scope = eventIdempotencyScope({
    eventId: normalizedEventId,
    eventType,
    dueAt,
    refs,
    payload,
  });
  const idempotencyKey = [
    'ppl',
    normalizedWorkspaceId,
    eventType,
    String(version),
    scope,
  ].join(':');

  return Object.freeze({
    eventId: normalizedEventId,
    schemaVersion: 1,
    eventType,
    eventCategory: isDue
      ? EVENT_CATEGORIES.SCHEDULED_DUE_EVENT
      : EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
    triggerType: isDue ? 'system_time' : 'committed_domain_event',
    source: 'teaching_preparation',
    origin: 'teaching_preparation',
    aggregateType: 'preparation_workspace',
    aggregateId: normalizedWorkspaceId,
    aggregateVersion: version,
    occurredAt,
    dueAt: isDue ? dueAt : null,
    correlationId: normalizedCorrelationId,
    causationId,
    idempotencyKey,
    payload: Object.freeze({
      ...payload,
      changedDependencyRefs: Object.freeze(refs),
    }),
    auditRefs,
    provenanceRefs,
  });
}

function coalescePreparationInputChanges(events = []) {
  const groups = new Map();
  for (const event of events) {
    if (event.eventType !== TEACHING_EVENTS.PREPARATION_INPUT_CHANGED) {
      throw new TypeError('PPL input-change coalescer accepts preparation_input_changed events only.');
    }
    const key = `${event.aggregateId}:${event.aggregateVersion}`;
    const prior = groups.get(key) || {
      ...event,
      payload: { ...(event.payload || {}), changedDependencyRefs: [] },
      provenanceRefs: [],
      auditRefs: [],
    };
    prior.payload.changedDependencyRefs.push(...(event.payload?.changedDependencyRefs || []));
    prior.provenanceRefs.push(...(event.provenanceRefs || []));
    prior.auditRefs.push(...(event.auditRefs || []));
    groups.set(key, prior);
  }

  return Object.freeze([...groups.values()].map((event) => {
    const mergedRefs = [...new Set(event.payload.changedDependencyRefs)].sort();
    return Object.freeze({
      ...event,
      idempotencyKey: [
        'ppl',
        event.aggregateId,
        event.eventType,
        String(event.aggregateVersion),
        digestRefs(mergedRefs),
      ].join(':'),
      payload: Object.freeze({
        ...event.payload,
        changedDependencyRefs: Object.freeze(mergedRefs),
      }),
      provenanceRefs: Object.freeze([...new Set(event.provenanceRefs)].sort()),
      auditRefs: Object.freeze([...new Set(event.auditRefs)].sort()),
    });
  }));
}

function createPreparationEventScheduler({ dueEventStore, outboxStore } = {}) {
  if (!dueEventStore || typeof dueEventStore.enqueue !== 'function') {
    throw new TypeError('PPL event scheduler requires the D02 due-event store.');
  }
  if (!outboxStore || typeof outboxStore.append !== 'function') {
    throw new TypeError('PPL event scheduler requires the D05 event outbox store.');
  }

  async function enqueue(event) {
    if (!event || !PPL_EVENT_TYPES.includes(event.eventType)) {
      throw new TypeError('PPL event scheduler accepts canonical preparation events only.');
    }
    return DUE_PPL_EVENTS.has(event.eventType)
      ? dueEventStore.enqueue(event)
      : outboxStore.append(event);
  }

  return Object.freeze({ enqueue });
}

module.exports = {
  PPL_EVENT_TYPES,
  DUE_PPL_EVENTS,
  buildPreparationEvent,
  coalescePreparationInputChanges,
  createPreparationEventScheduler,
};
