'use strict';

const { validateTeachingEvent } = require('./contracts');

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

module.exports = { createTeachingEventDispatcher };
