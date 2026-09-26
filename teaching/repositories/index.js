'use strict';

const { createTeachingKernelPersistence } = require('./kernel-persistence');
const { createPreparationRuntimeRepository } = require('./preparation-runtime');

function requireMethod(value, name) {
  if (!value || typeof value[name] !== 'function') {
    throw new TypeError(`Teaching repository dependency requires ${name}().`);
  }
}

function createTeachingRepositories({ subjectReader, notificationInterface }) {
  requireMethod(subjectReader, 'listForUser');
  requireMethod(subjectReader, 'getForUser');
  requireMethod(notificationInterface, 'send');

  return Object.freeze({
    subjects: Object.freeze({
      listForUser: (userId) => subjectReader.listForUser(userId),
      getForUser: (userId, subjectId) => subjectReader.getForUser(userId, subjectId),
    }),
    notifications: Object.freeze({
      send: (event) => notificationInterface.send(event),
      available: notificationInterface.available === true,
    }),
  });
}

module.exports = {
  createTeachingRepositories,
  createTeachingKernelPersistence,
  createPreparationRuntimeRepository,
};
