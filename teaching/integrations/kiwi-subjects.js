'use strict';

function createKiwiSubjectReader({ subjects }) {
  if (!subjects || typeof subjects.findManyWithDecks !== 'function') {
    throw new TypeError('KIWI Subject adapter requires subjects.findManyWithDecks(userId).');
  }

  async function listForUser(userId) {
    if (!userId) throw new TypeError('userId is required.');
    const rows = await subjects.findManyWithDecks(String(userId));
    return Array.isArray(rows) ? rows : [];
  }

  async function getForUser(userId, subjectId) {
    const subjectsForUser = await listForUser(userId);
    return subjectsForUser.find((subject) => String(subject.id) === String(subjectId)) || null;
  }

  return Object.freeze({
    listForUser,
    getForUser,
  });
}

module.exports = { createKiwiSubjectReader };
