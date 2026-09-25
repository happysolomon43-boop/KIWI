'use strict';

const { RECONCILIATION_DISPOSITIONS } = require('./constants');

function normalizeReconciliation(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('Event reconciliation must return an object.');
  }

  const disposition = String(result.disposition || '').trim().toUpperCase();
  if (!Object.values(RECONCILIATION_DISPOSITIONS).includes(disposition)) {
    throw new TypeError(`Unsupported event reconciliation disposition: ${result.disposition}`);
  }

  return Object.freeze({
    disposition,
    reason: result.reason == null ? null : String(result.reason),
    currentAggregateVersion: result.currentAggregateVersion == null
      ? null
      : Number(result.currentAggregateVersion),
    metadata: Object.freeze({ ...(result.metadata || {}) }),
  });
}

function requireReconciler(reconcile) {
  if (typeof reconcile !== 'function') {
    throw new TypeError(
      'Durable academic event handlers require an authoritative-state reconciler before execution.'
    );
  }
  return reconcile;
}

module.exports = {
  RECONCILIATION_DISPOSITIONS,
  normalizeReconciliation,
  requireReconciler,
};
