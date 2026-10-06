'use strict';

const { normalizeScheduleInputs } = require('../d09/contracts');
const { TEACHING_EVENTS } = require('../events/names');
const { EVENT_CATEGORIES } = require('../runtime/constants');

function validateRequestForReview(request = {}) {
  const type = String(request.type || request.request_type || '').toUpperCase();
  if (type === 'PERMANENT_AVAILABILITY_CHANGE') {
    normalizeScheduleInputs(request.requestedChange?.scheduleInputs || request.requested_change?.scheduleInputs || {});
  }
  return true;
}

function decorateD10RequestExperience(service, options = {}) {
  if (!service || typeof service.submitRequest !== 'function' || typeof service.reviewRequest !== 'function') return service;
  const repository = options.repository || null;
  const transactionalMutation = options.transactionalMutation || null;
  const randomUUID = options.randomUUID || null;
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date();

  async function rejectInvalidReview(user, requestId, current, cause) {
    if (!repository?.recordDecisionUsing || !transactionalMutation?.mutateAndPublish || typeof randomUUID !== 'function') throw cause;
    let reviewing = current;
    if (String(reviewing?.state || '').toUpperCase() === 'SUBMITTED') {
      reviewing = await service.submitRequest(user, requestId);
    }
    if (String(reviewing?.state || '').toUpperCase() !== 'REVIEWING') throw cause;

    const code = String(cause?.code || 'TEACHING_D10_REQUEST_VALIDATION_FAILED');
    const decision = Object.freeze({
      code,
      explanation: 'The requested change could not be reviewed because its scheduling inputs are invalid. Correct the request and submit a new one.',
      validationError: String(cause?.message || 'Invalid request inputs.'),
      owner: reviewing?.target?.owner || null,
    });
    const now = clock();
    const occurredAt = (now instanceof Date ? now : new Date(now)).toISOString();
    const wrapper = await transactionalMutation.mutateAndPublish({
      mutate: (tx) => repository.recordDecisionUsing(tx, {
        studentId: user.id,
        requestId,
        decisionState: 'REJECTED',
        decision,
        alternativeProposal: null,
        reason: code,
        expectedVersion: reviewing.stateVersion,
      }),
      buildEvent: (result) => ({
        eventId: randomUUID(),
        schemaVersion: 1,
        eventType: TEACHING_EVENTS.REQUEST_DECIDED,
        eventCategory: EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT,
        triggerType: 'committed_domain_event',
        source: 'request',
        origin: 'd10',
        actorId: null,
        aggregateType: 'REQUEST',
        aggregateId: requestId,
        aggregateVersion: Number(result.state_version),
        occurredAt,
        effectiveAt: occurredAt,
        dueAt: null,
        correlationId: null,
        causationId: null,
        idempotencyKey: `d10-request-decided:${requestId}:${result.state_version}`,
        payload: {
          request_id: requestId,
          decision_state: 'REJECTED',
          target_owner: result.target_owner,
        },
        auditRefs: [],
        provenanceRefs: [],
      }),
    });
    const detail = await service.getRequest(user, requestId);
    return Object.freeze({ ...detail, recoveredFromInvalidReview: true, decision: wrapper.mutationResult.decision || detail.decision });
  }

  async function submitRequest(user, requestId) {
    const current = await service.getRequest(user, requestId);
    validateRequestForReview(current);
    const submitted = await service.submitRequest(user, requestId);
    if (String(submitted?.state || '').toUpperCase() !== 'REVIEWING') return submitted;
    try {
      return await service.reviewRequest(user, requestId);
    } catch (error) {
      if (String(error?.code || '').startsWith('TEACHING_D09_')) return rejectInvalidReview(user, requestId, submitted, error);
      throw error;
    }
  }

  async function reviewRequest(user, requestId) {
    const current = await service.getRequest(user, requestId);
    try {
      validateRequestForReview(current);
    } catch (error) {
      if (['SUBMITTED','REVIEWING'].includes(String(current?.state || '').toUpperCase())) {
        return rejectInvalidReview(user, requestId, current, error);
      }
      throw error;
    }
    try {
      return await service.reviewRequest(user, requestId);
    } catch (error) {
      if (String(error?.code || '').startsWith('TEACHING_D09_') && ['SUBMITTED','REVIEWING'].includes(String(current?.state || '').toUpperCase())) {
        return rejectInvalidReview(user, requestId, current, error);
      }
      throw error;
    }
  }

  return Object.freeze({
    ...service,
    submitRequest,
    reviewRequest,
  });
}

module.exports = { validateRequestForReview, decorateD10RequestExperience };
