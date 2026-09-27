'use strict';

const express = require('express');
const { createTeachingFoundation } = require('./teaching');

function sendError(res, error, fallbackMessage) {
  const status = Number(error?.status) || 500;
  res.status(status).json({
    error: error?.message || fallbackMessage,
    ...(error?.code ? { code: error.code } : {}),
  });
}

function createTeachingRouter({
  authenticate,
  reckoningLockout,
  env = process.env,
  subjectSource,
  notificationPublisher = null,
  query = null,
  withTransaction = null,
  randomUUID = null,
  d07Intelligence = null,
  d07Service = null,
} = {}) {
  if (typeof authenticate !== 'function') {
    throw new TypeError('KIWI Teaching backend requires the existing authenticate middleware.');
  }
  if (!subjectSource || typeof subjectSource.findManyWithDecks !== 'function') {
    throw new TypeError('KIWI Teaching backend requires the existing KIWI Subject data source.');
  }

  const foundation = createTeachingFoundation({
    env,
    subjectSource,
    notificationPublisher,
    query,
    withTransaction,
    randomUUID,
    d07Intelligence,
  });
  const router = express.Router();
  let d07Ready = Boolean(d07Service);

  router.assertD07Ready = async () => {
    if (!foundation.d07?.repository) {
      d07Ready = false;
      return false;
    }
    await foundation.d07.repository.assertReady();
    d07Ready = true;
    return true;
  };

  // Teaching is a normal authenticated KIWI application surface.
  // D01's former per-account/feature availability gate was removed by the
  // 2026-09-25 Class-E feature-availability amendment.
  router.use(authenticate);

  router.get('/status', (req, res) => {
    res.json(foundation.service.statusForUser(req.user));
  });

  // Reckoning remains a platform-level lock. This is an authority rule, not
  // a Teaching feature toggle.
  if (typeof reckoningLockout === 'function') {
    router.use(reckoningLockout);
  }

  // D01 exposes read-only foundation seams only. No Teaching academic mutation
  // endpoint exists in this delivery.
  router.get('/subjects', async (req, res) => {
    try {
      res.json(await foundation.service.listSubjects(req.user));
    } catch (error) {
      sendError(res, error, 'Failed to load KIWI Subjects for Teaching.');
    }
  });

  router.get('/subjects/:id', async (req, res) => {
    try {
      res.json(await foundation.service.getSubject(req.user, req.params.id));
    } catch (error) {
      sendError(res, error, 'Failed to load KIWI Subject for Teaching.');
    }
  });

  const courseIntakeService = d07Service || foundation.d07?.service || null;
  if (courseIntakeService) {
    router.use('/courses', (req, res, next) => {
      if (d07Ready) return next();
      return res.status(503).json({
        error: 'Teaching Course setup is unavailable until the D07 schema is ready.',
        code: 'TEACHING_D07_SCHEMA_NOT_READY',
      });
    });
    router.get('/courses', async (req, res) => {
      try { res.json(await courseIntakeService.listCourses(req.user)); }
      catch (error) { sendError(res, error, 'Failed to load Teaching Courses.'); }
    });
    router.post('/courses', async (req, res) => {
      try { res.status(201).json(await courseIntakeService.createCourse(req.user, req.body)); }
      catch (error) { sendError(res, error, 'Failed to create Teaching Course.'); }
    });
    router.get('/courses/:id/setup', async (req, res) => {
      try { res.json(await courseIntakeService.getSetup(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Course setup.'); }
    });
    router.post('/courses/:id/intake', async (req, res) => {
      try { res.status(201).json(await courseIntakeService.submitIntake(req.user, req.params.id, req.body)); }
      catch (error) { sendError(res, error, 'Failed to save Student Course Intake.'); }
    });
    router.patch('/courses/:id/interaction-preferences', async (req, res) => {
      try { res.json(await courseIntakeService.editPreferences(req.user, req.params.id, req.body)); }
      catch (error) { sendError(res, error, 'Failed to update interaction preferences.'); }
    });
    router.post('/courses/:id/curriculum-audit', async (req, res) => {
      try { res.status(201).json(await courseIntakeService.runAudit(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to run Curriculum Audit.'); }
    });
    router.post('/courses/:id/diagnostic-plan', async (req, res) => {
      try { res.status(201).json(await courseIntakeService.planDiagnostic(req.user, req.params.id, req.body)); }
      catch (error) { sendError(res, error, 'Failed to prepare targeted Diagnostic.'); }
    });
    router.post('/courses/:id/validated-prior-knowledge', async (req, res) => {
      try { res.status(201).json(await courseIntakeService.decideVpk(req.user, req.params.id, req.body)); }
      catch (error) { sendError(res, error, 'Failed to record prior-knowledge decision.'); }
    });
  }

  router.get('/integrations/exam', (req, res) => {
    try {
      res.json(foundation.service.getExamInterface(req.user));
    } catch (error) {
      sendError(res, error, 'Failed to resolve the KIWI Exam interface.');
    }
  });

  return router;
}

module.exports = {
  createTeachingRouter,
};
