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
      id: token === 'user-a' ? 'user-a' : 'other-user',
      role: 'user',
    };
    next();
  }

  app.use('/api/teaching', createTeachingRouter({
    authenticate,
    reckoningLockout: (req, res, next) => next(),
    env: {
      NODE_ENV: 'test',
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

test('Teaching routes require KIWI authentication but have no feature-availability gate', async () => {
  await withServer(async (base) => {
    const unauthenticated = await fetch(`${base}/api/teaching/status`);
    assert.equal(unauthenticated.status, 401);

    const headers = { Authorization: 'Bearer user-a' };

    const statusResponse = await fetch(`${base}/api/teaching/status`, { headers });
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.status, 'foundation-ready');
    assert.equal(status.access, 'authenticated');
    assert.equal(Object.hasOwn(status, 'available'), false);
    assert.equal(Object.hasOwn(status, 'flags'), false);
  });
});

test('any authenticated KIWI user can read scoped Subjects and existing Exam interface metadata', async () => {
  await withServer(async (base) => {
    const headers = { Authorization: 'Bearer user-a' };

    const statusResponse = await fetch(`${base}/api/teaching/status`, { headers });
    const status = await statusResponse.json();
    const subjectsResponse = await fetch(`${base}/api/teaching/subjects`, { headers });
    assert.equal(subjectsResponse.status, 200);
    assert.deepEqual(await subjectsResponse.json(), [
      { id: 'subject-1', user_id: 'user-a', name: 'Physics', decks: [] },
    ]);

    const subjectResponse = await fetch(`${base}/api/teaching/subjects/subject-1`, { headers });
    assert.equal(subjectResponse.status, 200);
    assert.equal((await subjectResponse.json()).user_id, 'user-a');

    const examResponse = await fetch(`${base}/api/teaching/integrations/exam`, { headers });
    assert.equal(examResponse.status, 200);
    const exam = await examResponse.json();
    assert.equal(exam.owner, 'kiwi-exam');
    assert.equal(exam.configurationRoute, 'exam-config');
  });
});

test('D07 authenticated Course setup routes preserve service ownership and route results', async () => {
  const calls = [];
  const d07Service = {
    async listCourses(user) { calls.push(['list', user.id]); return []; },
    async createCourse(user, body) { calls.push(['create', user.id, body.subjectId]); return { course_id: 'course-1', lifecycle_state: 'DRAFT' }; },
    async getSetup(user, id) { calls.push(['setup', user.id, id]); return { course: { course_id: id } }; },
    async submitIntake(user, id, body) { calls.push(['intake', user.id, id, body.originalFreeFormText]); return { extractionStatus: 'ROUTE_HELD_UNTIL_D30' }; },
    async editPreferences(user, id, body) { calls.push(['preferences', user.id, id, body.example_first]); return { ok: true }; },
    async queueAudit(user, id) { calls.push(['audit', user.id, id]); return { accepted: true, background: true, jobId: 'a1', status: 'PENDING' }; },
    async planDiagnostic(user, id) { calls.push(['diagnostic', user.id, id]); return { requirement_state: 'NOT_REQUIRED' }; },
    async decideVpk(user, id) { calls.push(['vpk', user.id, id]); return { decision_status: 'NOT_VALIDATED' }; },
  };
  const app = express(); app.use(express.json());
  app.use('/api/teaching', createTeachingRouter({
    authenticate(req,res,next){ if(!req.headers.authorization)return res.sendStatus(401); req.user={id:'user-a'};next(); },
    reckoningLockout(req,res,next){next();}, env:{NODE_ENV:'test'},
    subjectSource:{async findManyWithDecks(){return[];}}, d07Service,
  }));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { const base=`http://127.0.0.1:${server.address().port}/api/teaching`; const headers={Authorization:'Bearer x','Content-Type':'application/json'};
    assert.equal((await fetch(`${base}/courses`,{headers})).status,200);
    assert.equal((await fetch(`${base}/courses`,{method:'POST',headers,body:JSON.stringify({subjectId:'s1'})})).status,201);
    assert.equal((await fetch(`${base}/courses/course-1/setup`,{headers})).status,200);
    assert.equal((await fetch(`${base}/courses/course-1/intake`,{method:'POST',headers,body:JSON.stringify({originalFreeFormText:'hello'})})).status,201);
    assert.equal((await fetch(`${base}/courses/course-1/interaction-preferences`,{method:'PATCH',headers,body:JSON.stringify({example_first:true})})).status,200);
    assert.equal((await fetch(`${base}/courses/course-1/curriculum-audit`,{method:'POST',headers,body:'{}'})).status,202);
    assert.equal((await fetch(`${base}/courses/course-1/diagnostic-plan`,{method:'POST',headers,body:'{}'})).status,201);
    assert.equal((await fetch(`${base}/courses/course-1/validated-prior-knowledge`,{method:'POST',headers,body:'{}'})).status,201);
    assert.deepEqual(calls.map(x=>x[0]),['list','create','setup','intake','preferences','audit','diagnostic','vpk']);
  } finally { await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
});
