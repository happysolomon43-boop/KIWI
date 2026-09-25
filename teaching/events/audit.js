'use strict';

const { assertAcademicTimestamp } = require('../domain/time');

function createAuditEvent(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Audit event input is required.');
  }

  for (const field of ['auditId', 'action', 'actorId', 'entityType', 'entityId']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      throw new TypeError(`Audit event ${field} is required.`);
    }
  }

  return Object.freeze({
    auditId: input.auditId.trim(),
    action: input.action.trim(),
    actorId: input.actorId.trim(),
    entityType: input.entityType.trim(),
    entityId: input.entityId.trim(),
    occurredAt: assertAcademicTimestamp(input.occurredAt, 'occurredAt'),
    correlationId: input.correlationId ? String(input.correlationId) : null,
    reason: input.reason ? String(input.reason) : null,
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}

module.exports = { createAuditEvent };
