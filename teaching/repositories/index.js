'use strict';

const { createTeachingKernelPersistence } = require('./kernel-persistence');
const { createPreparationRuntimeRepository } = require('./preparation-runtime');
const { createD07CourseIntakeRepository } = require('./d07-course-intake');
const { createD08CoursePlanRepository } = require('./d08-course-plan');

function requireMethod(value, name) {
  if (!value || typeof value[name] !== 'function') {
    throw new TypeError(`Teaching repository dependency requires ${name}().`);
  }
}

function createTeachingRepositories({ subjectReader, notificationInterface }) {
  requireMethod(subjectReader, 'listForUser');
  requireMethod(subjectReader, 'getForUser');
  requireMethod(subjectReader, 'getCorpusForUser');
  requireMethod(notificationInterface, 'send');

  return Object.freeze({
    subjects: Object.freeze({
      listForUser: (userId) => subjectReader.listForUser(userId),
      getForUser: (userId, subjectId) => subjectReader.getForUser(userId, subjectId),
      getCorpusForUser: (userId, subjectId) => subjectReader.getCorpusForUser(userId, subjectId),
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
  createD07CourseIntakeRepository,
  createD08CoursePlanRepository,
};
