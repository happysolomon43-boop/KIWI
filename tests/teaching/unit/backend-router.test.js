'use strict';

const http = require('http');
const express = require('express');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTeachingRouter } = require('../../../teaching-backend');

async function withServer(run) {
  const app = express();
  app.use(express.json());

  const subjectSource = {
    async findManyWithDecks(userId) {
      return [
        { id: 'subject-1', user_id: userId, name: 'Physics', decks: [] },
      ];
    },
  };

  function authenticate(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Missing access token' });
    req.user = {
      id: token === 'enabled' ? 'dev-user' : 'other-user',
      role: 'user',
    };
    next();
  }

  app.use('/api/teaching', createTeachingRouter({
    authenticate,
    reckoningLockout: (req, res, next) => next(),
    env: {
      NODE_ENV: 'test',
      TEACHING_DEV_USER_IDS: 'dev-user',
    },
    subjectSource,
  }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('Teaching status reports feature availability without exposing disabled routes', async () => {
  await withServer(async (base) => {
    const disabledStatus = await fetch(`${base}/api/teaching/status`, {
      headers: { Authorization: 'Bearer disabled' },
    });
    assert.equal(disabledStatus.status, 200);
    assert.equal((await disabledStatus.json()).available, false);

    const disabledSubjects = await fetch(`${base}/api/teaching/subjects`, {
      headers: { Authorization: 'Bearer disabled' },
    });
    assert.equal(disabledSubjects.status, 403);
    assert.equal((await disabledSubjects.json()).code, 'TEACHING_NOT_ENABLED');
  });
});

test('allowlisted D01 user can read scoped Subjects and existing Exam interface metadata', async () => {
  await withServer(async (base) => {
    const headers = { Authorization: 'Bearer enabled' };

    const statusResponse = await fetch(`${base}/api/teaching/status`, { headers });
    const status = await statusResponse.json();
    assert.equal(status.available, true);
    assert.equal(status.flags.highStakesMarking, false);

    const subjectsResponse = await fetch(`${base}/api/teaching/subjects`, { headers });
    assert.equal(subjectsResponse.status, 200);
    assert.deepEqual(await subjectsResponse.json(), [
      { id: 'subject-1', user_id: 'dev-user', name: 'Physics', decks: [] },
    ]);

    const subjectResponse = await fetch(`${base}/api/teaching/subjects/subject-1`, { headers });
    assert.equal(subjectResponse.status, 200);
    assert.equal((await subjectResponse.json()).user_id, 'dev-user');

    const examResponse = await fetch(`${base}/api/teaching/integrations/exam`, { headers });
    assert.equal(examResponse.status, 200);
    const exam = await examResponse.json();
    assert.equal(exam.owner, 'kiwi-exam');
    assert.equal(exam.configurationRoute, 'exam-config');
  });
});
