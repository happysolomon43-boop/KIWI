'use strict';

const { SESSION_PHASES } = require('./constants');
const { notImplemented } = require('./errors');

function createStateMachine() {
  return Object.freeze({
    name: 'reckoning-state-machine',
    phases: SESSION_PHASES,
    transition() {
      return notImplemented('stateMachine.transition');
    },
  });
}

module.exports = { createStateMachine };
