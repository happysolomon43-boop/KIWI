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

  async function getCorpusForUser(userId, subjectId) {
    if (!userId || !subjectId) throw new TypeError('userId and subjectId are required.');
    if (typeof subjects.getCorpusForUser === 'function') {
      const corpus = await subjects.getCorpusForUser(String(userId), String(subjectId));
      if (!corpus || String(corpus.subject?.user_id) !== String(userId)) return null;
      return corpus;
    }
    const subject = await getForUser(userId, subjectId);
    return subject ? Object.freeze({ subject, decks: Object.freeze(subject.decks || []), cards: Object.freeze([]) }) : null;
  }

  return Object.freeze({
    listForUser,
    getForUser,
    getCorpusForUser,
  });
}

module.exports = { createKiwiSubjectReader };
