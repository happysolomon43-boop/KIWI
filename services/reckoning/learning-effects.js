'use strict';

const { notImplemented } = require('./errors');

function createLearningEffectsEngine() {
  return Object.freeze({
    name: 'reckoning-learning-effects-engine',
    buildEffects() {
      return notImplemented('learningEffects.buildEffects');
    },
    applyOnce() {
      return notImplemented('learningEffects.applyOnce');
    },
  });
}

module.exports = { createLearningEffectsEngine };
