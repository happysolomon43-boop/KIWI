'use strict';

const { EVIDENCE_STATUSES } = require('./constants');
const { notImplemented } = require('./errors');

function createEvidenceEngine() {
  return Object.freeze({
    name: 'reckoning-evidence-engine',
    statuses: EVIDENCE_STATUSES,
    record() {
      return notImplemented('evidence.record');
    },
    evaluate() {
      return notImplemented('evidence.evaluate');
    },
  });
}

module.exports = { createEvidenceEngine };
