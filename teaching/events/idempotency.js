'use strict';

function createInMemoryIdempotencyStore() {
  const completed = new Map();

  return {
    async get(key) {
      return completed.get(String(key)) || null;
    },
    async put(key, value) {
      completed.set(String(key), value);
      return value;
    },
    async clear() {
      completed.clear();
    },
  };
}

function createIdempotentHandler({ store, handler }) {
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    throw new TypeError('Idempotency handler requires a get/put store.');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('Idempotency handler requires a handler function.');
  }

  return async function idempotentHandle(key, input) {
    if (!key || typeof key !== 'string') {
      throw new TypeError('Idempotency key is required.');
    }

    const prior = await store.get(key);
    if (prior) {
      return { replay: true, result: prior.result };
    }

    const result = await handler(input);
    await store.put(key, { result });
    return { replay: false, result };
  };
}

module.exports = {
  createInMemoryIdempotencyStore,
  createIdempotentHandler,
};
