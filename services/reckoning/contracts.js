'use strict';

const { ReckoningContractError } = require('./errors');

const ENGINE_METHODS = Object.freeze([
  'describe',
  'prepare',
  'start',
  'recordAnswer',
  'getState',
  'finalize',
]);

const COMPONENT_FACTORIES = Object.freeze([
  'createRiskEngine',
  'createPlanner',
  'createScheduler',
  'createEvidenceEngine',
  'createQuestionBank',
  'createQuestionValidator',
  'createScoringEngine',
  'createLearningEffectsEngine',
  'createReckoningStore',
  'createStateMachine',
]);

function assertEngineContract(engine) {
  if (!engine || typeof engine !== 'object') {
    throw new ReckoningContractError('Reckoning engine must be an object.');
  }

  for (const method of ENGINE_METHODS) {
    if (typeof engine[method] !== 'function') {
      throw new ReckoningContractError(
        `Reckoning engine is missing required method: ${method}`
      );
    }
  }

  return engine;
}

module.exports = {
  ENGINE_METHODS,
  COMPONENT_FACTORIES,
  assertEngineContract,
};
