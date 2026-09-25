'use strict';

function createTeachingService({ config, repositories, examInterface }) {
  if (!config) throw new TypeError('Teaching service requires config.');
  if (!repositories || !repositories.subjects) throw new TypeError('Teaching service requires repositories.');
  if (!examInterface || typeof examInterface.buildHandoff !== 'function') {
    throw new TypeError('Teaching service requires the KIWI Exam interface.');
  }

  function statusForUser(user) {
    return Object.freeze({
      ok: true,
      mode: 'teaching',
      status: 'foundation-ready',
      access: user?.id ? 'authenticated' : 'unknown',
    });
  }

  async function listSubjects(user) {
    return repositories.subjects.listForUser(user.id);
  }

  async function getSubject(user, subjectId) {
    const subject = await repositories.subjects.getForUser(user.id, subjectId);
    if (!subject) {
      const error = new Error('Subject not found.');
      error.status = 404;
      error.code = 'TEACHING_SUBJECT_NOT_FOUND';
      throw error;
    }
    return subject;
  }

  function getExamInterface() {
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
    listSubjects,
    getSubject,
    getExamInterface,
  });
}

module.exports = { createTeachingService };
