'use strict';

const { RISK_LEVELS } = require('./constants');
const { notImplemented } = require('./errors');

function createRiskEngine() {
  return Object.freeze({
    name: 'reckoning-risk-engine',
    levels: RISK_LEVELS,
    score() {
      return notImplemented('riskEngine.score');
    },
  });
}

module.exports = { createRiskEngine };
