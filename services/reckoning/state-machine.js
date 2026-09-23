'use strict';

const { SESSION_PHASES } = require('./constants');
const { ReckoningContractError } = require('./errors');

const ALLOWED_TRANSITIONS = Object.freeze({
  [SESSION_PHASES.PREPARING]: Object.freeze([SESSION_PHASES.ACTIVE]),
  [SESSION_PHASES.ACTIVE]: Object.freeze([SESSION_PHASES.FINALIZING]),
  [SESSION_PHASES.FINALIZING]: Object.freeze([SESSION_PHASES.COMPLETE]),
  [SESSION_PHASES.COMPLETE]: Object.freeze([]),
});

function createStateMachine() {
  function transition(current, next) {
    const from = String(current || '');
    const to = String(next || '');
    if (!Object.values(SESSION_PHASES).includes(from)) {
      throw new ReckoningContractError(`Unknown Reckoning phase: ${from}`);
    }
    if (!Object.values(SESSION_PHASES).includes(to)) {
      throw new ReckoningContractError(`Unknown Reckoning phase: ${to}`);
    }
    if (from === to) return to;
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ReckoningContractError(
        `Invalid Reckoning phase transition: ${from} -> ${to}`
      );
    }
    return to;
  }

  return Object.freeze({
    name: 'reckoning-state-machine',
    phases: SESSION_PHASES,
    transitions: ALLOWED_TRANSITIONS,
    transition,
  });
}

module.exports = {
  ALLOWED_TRANSITIONS,
  createStateMachine,
};
