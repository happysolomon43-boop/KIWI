'use strict';

const { EVENT_CATEGORIES } = require('./constants');
const { validateTeachingEvent } = require('../events/contracts');

function createTransactionalTeachingMutation({
  withTransaction,
  outboxStore,
  dueEventStore = null,
} = {}) {
  if (typeof withTransaction !== 'function') {
    throw new TypeError('Transactional Teaching mutation requires withTransaction().');
  }
  if (!outboxStore || typeof outboxStore.appendUsing !== 'function') {
    throw new TypeError('Transactional Teaching mutation requires the D05 event outbox store.');
  }
  if (dueEventStore != null && typeof dueEventStore.enqueueUsing !== 'function') {
    throw new TypeError('Transactional Teaching mutation dueEventStore must expose enqueueUsing().');
  }

  async function appendResultingEvent(tx, event) {
    const queryFn = tx.query.bind(tx);
    if (event.eventCategory === EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT) {
      return outboxStore.appendUsing(queryFn, event);
    }
    if (event.eventCategory === EVENT_CATEGORIES.SCHEDULED_DUE_EVENT) {
      if (!dueEventStore) {
        const error = new Error(
          'Scheduled Teaching event publication requires the existing D02 due-event store.'
        );
        error.code = 'TEACHING_D05_DUE_EVENT_STORE_REQUIRED';
        throw error;
      }
      return dueEventStore.enqueueUsing(queryFn, event);
    }

    const error = new Error(
      'Authoritative mutation publication may emit only a committed domain fact or a scheduled due event.'
    );
    error.code = 'TEACHING_D05_MUTATION_EVENT_AUTHORITY_INVALID';
    throw error;
  }

  async function mutateAndPublish({ mutate, buildEvent } = {}) {
    if (typeof mutate !== 'function') throw new TypeError('mutateAndPublish requires mutate().');
    if (typeof buildEvent !== 'function') throw new TypeError('mutateAndPublish requires buildEvent().');

    return withTransaction(async (tx) => {
      if (!tx || typeof tx.query !== 'function') {
        throw new TypeError('Teaching transaction must expose query().');
      }

      const mutationResult = await mutate(tx);
      const event = validateTeachingEvent(await buildEvent(mutationResult));
      const publication = await appendResultingEvent(tx, event);
      return Object.freeze({ mutationResult, publication });
    });
  }

  return Object.freeze({ mutateAndPublish });
}

module.exports = { createTransactionalTeachingMutation };
