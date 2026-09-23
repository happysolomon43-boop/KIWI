'use strict';

const { QUESTION_ROLES } = require('./constants');
const { notImplemented } = require('./errors');

function createQuestionBank() {
  return Object.freeze({
    name: 'reckoning-question-bank',
    roles: QUESTION_ROLES,
    buildBlueprints() {
      return notImplemented('questionBank.buildBlueprints');
    },
    generate() {
      return notImplemented('questionBank.generate');
    },
  });
}

module.exports = { createQuestionBank };
