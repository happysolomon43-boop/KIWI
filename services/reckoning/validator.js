'use strict';

const { notImplemented } = require('./errors');

function createQuestionValidator() {
  return Object.freeze({
    name: 'reckoning-question-validator',
    validateStructure() {
      return notImplemented('questionValidator.validateStructure');
    },
    validateSemantics() {
      return notImplemented('questionValidator.validateSemantics');
    },
  });
}

module.exports = { createQuestionValidator };
