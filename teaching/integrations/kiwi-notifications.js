'use strict';

function createKiwiNotificationInterface({ publish }) {
  if (publish != null && typeof publish !== 'function') {
    throw new TypeError('KIWI notification publish adapter must be a function.');
  }

  return Object.freeze({
    available: typeof publish === 'function',
    async send(event) {
      if (typeof publish !== 'function') {
        const error = new Error('KIWI notification publisher is not configured.');
        error.code = 'TEACHING_NOTIFICATION_PUBLISHER_UNAVAILABLE';
        throw error;
      }

      if (!event || typeof event !== 'object') {
        throw new TypeError('Notification event is required.');
      }

      return publish(Object.freeze({ ...event }));
    },
  });
}

module.exports = { createKiwiNotificationInterface };
