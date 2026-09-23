'use strict';

const { notImplemented } = require('./errors');

function createPlanner() {
  return Object.freeze({
    name: 'reckoning-planner',
    buildPlan() {
      return notImplemented('planner.buildPlan');
    },
  });
}

module.exports = { createPlanner };
