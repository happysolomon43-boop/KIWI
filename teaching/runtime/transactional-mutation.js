'use strict';

const { EVENT_CATEGORIES } = require('./constants');
const { validateTeachingEvent } = require('../events/contracts');

function createTransactionalTeachingMutation({ withTransaction, outboxStore } = {}) {
  if (typeof withTransaction !== 'function') throw new TypeError('Transactional Teaching mutation requires withTransaction().');
  if (!outboxStore || typeof outboxStore.appendUsing !== 'function') {
    throw new TypeError('Transactional Teaching mutation requires the D05 event outbox store.');
  }

  async function mutateAndPublish({ mutate, buildEvent } = {}) {
    if (typeof mutate !== 'function') throw new TypeError('mutateAndPublish requires mutate().');
    if (typeof buildEvent !== 'function') throw new TypeError('mutateAndPublish requires buildEvent().');

    return withTransaction(async (tx) => {
      if (!tx || typeof tx.query !== 'function') throw new TypeError('Teaching transaction must expose query().');
      const mutationResult = await mutate(tx);
      const event = validateTeachingEvent(await buildEvent(mutationResult));
      if (event.eventCategory !== EVENT_CATEGORIES.COMMITTED_DOMAIN_EVENT) {
        const error = new Error('Authoritative mutation publication must emit a committed_domain_event fact.');
        error.code = 'TEACHING_D05_MUTATION_EVENT_NOT_DOMAIN_FACT';
        throw error;
      }
      const publication = await outboxStore.appendUsing(tx.query.bind(tx), event);
      return Object.freeze({ mutationResult, publication });
    });
  }

  return Object.freeze({ mutateAndPublish });
}

module.exports = { createTransactionalTeachingMutation };
