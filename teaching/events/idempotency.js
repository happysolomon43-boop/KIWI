'use strict';

function createInMemoryIdempotencyStore() {
  const completed = new Map();
  const pending = new Map();

  return {
    // Atomic within this process. Durable/multi-process consumers must supply
    // a store whose runOnce operation claims ownership transactionally.
    async runOnce(key, operation) {
      if (completed.has(key)) return { replay: true, result: completed.get(key).result };
      if (pending.has(key)) return { replay: true, result: await pending.get(key) };
      const task = Promise.resolve().then(operation);
      pending.set(key, task);
      try {
        const result = await task;
        completed.set(key, { result });
        return { replay: false, result };
      } finally {
        pending.delete(key);
      }
    },
    async get(key) {
      return completed.get(String(key)) || null;
    },
    async put(key, value) {
      completed.set(String(key), value);
      return value;
    },
    async clear() {
      if (pending.size) throw new Error('Cannot clear an idempotency store with pending operations.');
      completed.clear();
    },
  };
}

function createIdempotentHandler({ store, handler }) {
  if (!store || typeof store.runOnce !== 'function') {
    throw new TypeError('Idempotency handler requires an atomic runOnce store.');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('Idempotency handler requires a handler function.');
  }

  return async function idempotentHandle(key, input) {
    if (!key || typeof key !== 'string') {
      throw new TypeError('Idempotency key is required.');
    }

    return store.runOnce(key, () => handler(input));
  };
}

module.exports = {
  createInMemoryIdempotencyStore,
  createIdempotentHandler,
};
