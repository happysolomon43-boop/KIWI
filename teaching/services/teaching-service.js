'use strict';

const { publicTeachingConfig } = require('../config');

function createTeachingService({ config, repositories, examInterface }) {
  if (!config || !config.featureFlags) throw new TypeError('Teaching service requires config.');
  if (!repositories || !repositories.subjects) throw new TypeError('Teaching service requires repositories.');
  if (!examInterface || typeof examInterface.buildHandoff !== 'function') {
    throw new TypeError('Teaching service requires the KIWI Exam interface.');
  }

  function statusForUser(user) {
    return Object.freeze({
      ok: true,
      mode: 'teaching',
      status: 'foundation-ready',
      ...publicTeachingConfig(config, user),
    });
  }

  function assertAvailable(user) {
    if (!config.featureFlags.teachingAvailableFor(user)) {
      const error = new Error('KIWI Teaching is not enabled for this account.');
      error.status = 403;
      error.code = 'TEACHING_NOT_ENABLED';
      throw error;
    }
  }

  async function listSubjects(user) {
    assertAvailable(user);
    return repositories.subjects.listForUser(user.id);
  }

  async function getSubject(user, subjectId) {
    assertAvailable(user);
    const subject = await repositories.subjects.getForUser(user.id, subjectId);
    if (!subject) {
      const error = new Error('Subject not found.');
      error.status = 404;
      error.code = 'TEACHING_SUBJECT_NOT_FOUND';
      throw error;
    }
    return subject;
  }

  function getExamInterface(user) {
    assertAvailable(user);
    return Object.freeze({
      version: examInterface.version,
      owner: examInterface.owner,
      surface: examInterface.surface,
      mainAppPath: examInterface.mainAppPath,
      configurationRoute: examInterface.configurationRoute,
      activeExamRoute: examInterface.activeExamRoute,
    });
  }

  return Object.freeze({
    statusForUser,
    assertAvailable,
    listSubjects,
    getSubject,
    getExamInterface,
  });
}

module.exports = { createTeachingService };
