'use strict';

const { RECKONING_ENGINE } = require('./constants');
const { createReckoningConfig } = require('./config');
const { notImplemented } = require('./errors');
const { assertEngineContract } = require('./contracts');

function createReckoningEngine(options = {}) {
  const config = createReckoningConfig(options.config);

  const engine = {
    describe() {
      return Object.freeze({
        name: RECKONING_ENGINE.NAME,
        engineVersion: config.engineVersion,
        architectureVersion: config.architectureVersion,
        status: RECKONING_ENGINE.STATUS,
        enabled: config.enabled,
        behaviorAuthority: config.behaviorAuthority,
      });
    },
    prepare() { return notImplemented('engine.prepare'); },
    start() { return notImplemented('engine.start'); },
    recordAnswer() { return notImplemented('engine.recordAnswer'); },
    getState() { return notImplemented('engine.getState'); },
    finalize() { return notImplemented('engine.finalize'); },
  };

  return Object.freeze(assertEngineContract(engine));
}

module.exports = {
  createReckoningEngine,
};
