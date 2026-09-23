'use strict';

const { notImplemented } = require('./errors');

function createScheduler() {
  return Object.freeze({
    name: 'reckoning-scheduler',
    chooseNext() {
      return notImplemented('scheduler.chooseNext');
    },
  });
}

module.exports = { createScheduler };
