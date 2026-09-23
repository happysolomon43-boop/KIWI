'use strict';

const { notImplemented } = require('./errors');

function createReckoningStore() {
  return Object.freeze({
    name: 'reckoning-store-port',
    getSession() {
      return notImplemented('store.getSession');
    },
    getEvidence() {
      return notImplemented('store.getEvidence');
    },
    saveSession() {
      return notImplemented('store.saveSession');
    },
    saveEvidence() {
      return notImplemented('store.saveEvidence');
    },
    withTransaction() {
      return notImplemented('store.withTransaction');
    },
  });
}

module.exports = { createReckoningStore };
