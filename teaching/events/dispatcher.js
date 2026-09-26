'use strict';

const { validateTeachingEvent } = require('./contracts');
const { TEACHING_EVENT_NAMES } = require('./names');

function createTeachingEventDispatcher({ publish }) {
  if (typeof publish !== 'function') {
    throw new TypeError('Teaching event dispatcher requires an injected publish function.');
  }

  return Object.freeze({
    async dispatch(event) {
      const validated = validateTeachingEvent(event);
      return publish(validated);
    },
  });
}

function createTeachingEventSubscriberRegistry() {
  const subscribers = new Map();

  function register(eventType, {
    subscriberId,
    handle,
  } = {}) {
    const normalizedEventType = String(eventType || '').trim();
    const normalizedSubscriberId = String(subscriberId || '').trim();

    if (!TEACHING_EVENT_NAMES.includes(normalizedEventType)) {
      throw new TypeError(`Cannot subscribe to unknown Teaching event type: ${normalizedEventType}`);
    }
    if (!normalizedSubscriberId) {
      throw new TypeError('Teaching event subscriber requires subscriberId.');
    }
    if (typeof handle !== 'function') {
      throw new TypeError('Teaching event subscriber requires handle().');
    }

    const existing = subscribers.get(normalizedEventType) || new Map();
    if (existing.has(normalizedSubscriberId)) {
      const error = new Error(
        `Duplicate Teaching event subscriber ${normalizedSubscriberId} for ${normalizedEventType}.`
      );
      error.code = 'TEACHING_EVENT_SUBSCRIBER_DUPLICATE';
      throw error;
    }
    existing.set(normalizedSubscriberId, handle);
    subscribers.set(normalizedEventType, existing);

    return Object.freeze({
      eventType: normalizedEventType,
      subscriberId: normalizedSubscriberId,
    });
  }

  async function publish(input) {
    const event = validateTeachingEvent(input);
    const handlers = subscribers.get(event.eventType);

    if (!handlers || handlers.size === 0) {
      const error = new Error(
        `No Teaching subscriber is registered for durable event ${event.eventType}; publication remains fail-closed.`
      );
      error.code = 'TEACHING_PUBLISHED_EVENT_HANDLER_MISSING';
      throw error;
    }

    const outcomes = [];
    for (const [subscriberId, handle] of handlers.entries()) {
      const result = await handle(event);
      outcomes.push(Object.freeze({
        subscriberId,
        result: result == null ? null : result,
      }));
    }
    return Object.freeze(outcomes);
  }

  function status() {
    return Object.freeze(
      [...subscribers.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([eventType, handlers]) => Object.freeze({
          eventType,
          subscriberIds: Object.freeze([...handlers.keys()].sort()),
        }))
    );
  }

  return Object.freeze({ register, publish, status });
}

module.exports = {
  createTeachingEventDispatcher,
  createTeachingEventSubscriberRegistry,
};
