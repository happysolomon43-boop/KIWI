'use strict';

const { notImplemented } = require('./errors');

function createScoringEngine() {
  return Object.freeze({
    name: 'reckoning-scoring-engine',
    calculateRecovery() {
      return notImplemented('scoring.calculateRecovery');
    },
  });
}

module.exports = { createScoringEngine };
