'use strict';

const { RECKONING_ENGINE } = require('./constants');

const PHASE1_RECKONING_CONFIG = Object.freeze({
  engineVersion: RECKONING_ENGINE.ENGINE_VERSION,
  architectureVersion: RECKONING_ENGINE.ARCHITECTURE_VERSION,
  enabled: false,
  behaviorAuthority: 'legacy',
});

function createReckoningConfig(overrides = {}) {
  return Object.freeze({
    ...PHASE1_RECKONING_CONFIG,
    ...overrides,
    enabled: false,
    behaviorAuthority: 'legacy',
  });
}

module.exports = {
  PHASE1_RECKONING_CONFIG,
  createReckoningConfig,
};
