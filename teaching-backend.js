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
  d08Intelligence = null,
  d08Service = null,
  d09Intelligence = null,
  d09Service = null,
  teachingRuntimePlatform = null,
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
    d08Intelligence,
    d09Intelligence,
    d09TransactionalMutation: teachingRuntimePlatform?.transactionalMutation || null,
  });
  const router = express.Router();
  let d07Ready = Boolean(d07Service);
  let d08Ready = Boolean(d08Service);
  let d09Ready = Boolean(d09Service);

  router.assertD07Ready = async () => {
    if (!foundation.d07?.repository) {
      d07Ready = false;
      return false;
    }
    await foundation.d07.repository.assertReady();
    d07Ready = true;
    return true;
  };

  router.assertD09Ready = async () => {
    if (!foundation.d09?.repository) {
      d09Ready = false;
      return false;
    }
    await foundation.d09.repository.assertReady();
    d09Ready = true;
    return true;
  };

  router.assertD08Ready = async () => {
    if (!foundation.d08?.repository) {
      d08Ready = false;
      return false;
    }
    await foundation.d08.repository.assertReady();
    d08Ready = true;
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


  const coursePlanService = d08Service || foundation.d08?.service || null;
  if (coursePlanService) {
    const requireD08Ready = (req, res, next) => {
      if (d08Ready) return next();
      return res.status(503).json({
        error: 'Teaching Course Plan and Coverage review is unavailable until the D08 schema is ready.',
        code: 'TEACHING_D08_SCHEMA_NOT_READY',
      });
    };

    router.get('/courses/:id/plan-review', requireD08Ready, async (req, res) => {
      try { res.json(await coursePlanService.getPlanReview(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Course Plan review.'); }
    });

    router.post('/courses/:id/course-plan', requireD08Ready, async (req, res) => {
      try { res.status(201).json(await coursePlanService.generateCoursePlan(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to prepare Course Plan.'); }
    });

    router.get('/courses/:id/coverage-report', requireD08Ready, async (req, res) => {
      try { res.json(await coursePlanService.getCoverageReport(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Course Coverage Report.'); }
    });

    router.get('/courses/:id/activation-coverage-decision', requireD08Ready, async (req, res) => {
      try { res.json(await coursePlanService.getActivationCoverageDecision(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to evaluate Course Coverage readiness.'); }
    });

    router.post('/courses/:id/coverage-audit', requireD08Ready, async (req, res) => {
      try {
        const stage = String(req.body?.stage || 'END_OF_COURSE').toUpperCase();
        if (stage !== 'END_OF_COURSE') {
          return res.status(400).json({
            error: 'Explicit Coverage Audit creation is supported for END_OF_COURSE only; pre-activation audit is created atomically with a Course Plan.',
            code: 'TEACHING_D08_COVERAGE_AUDIT_STAGE_INVALID',
          });
        }
        return res.status(201).json(await coursePlanService.auditEndOfCourse(req.user, req.params.id));
      } catch (error) { return sendError(res, error, 'Failed to run Course Coverage Audit.'); }
    });

    router.post('/courses/:id/scope-review', requireD08Ready, async (req, res) => {
      try { res.status(201).json(await coursePlanService.detectScopeChange(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to review Course scope changes.'); }
    });

    router.post('/courses/:id/scope-review/:scopeChangeId/analyze', requireD08Ready, async (req, res) => {
      try { res.json(await coursePlanService.analyzeScopeChange(req.user, req.params.id, req.params.scopeChangeId)); }
      catch (error) { sendError(res, error, 'Failed to analyze reviewed Course scope change.'); }
    });

    router.post('/courses/:id/scope-review/:scopeChangeId/apply', requireD08Ready, async (req, res) => {
      try { res.json(await coursePlanService.adoptAuthoritativeScopeChange(req.user, req.params.id, req.params.scopeChangeId)); }
      catch (error) { sendError(res, error, 'Failed to adopt reviewed Course scope change.'); }
    });

    router.post('/courses/:id/validated-prior-knowledge/:decisionId/recheck', requireD08Ready, async (req, res) => {
      try { res.status(201).json(await coursePlanService.reconcileVpkContradiction(req.user, req.params.id, req.params.decisionId, req.body)); }
      catch (error) { sendError(res, error, 'Failed to recheck Validated Prior Knowledge.'); }
    });
  }


  const schedulingService = d09Service || foundation.d09?.service || null;
  if (schedulingService) {
    const requireD09Ready = (req, res, next) => {
      if (d09Ready) return next();
      return res.status(503).json({
        error: 'Teaching Semester/Scheduling is unavailable until the D09 schema is ready.',
        code: 'TEACHING_D09_SCHEMA_NOT_READY',
      });
    };

    router.get('/semesters', requireD09Ready, async (req, res) => {
      try { res.json(await schedulingService.listSemesters(req.user)); }
      catch (error) { sendError(res, error, 'Failed to load Teaching Semesters.'); }
    });
    router.get('/courses/:id/schedule-review', requireD09Ready, async (req, res) => {
      try { res.json(await schedulingService.getScheduleReview(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Course scheduling review.'); }
    });
    router.put('/courses/:id/schedule-inputs', requireD09Ready, async (req, res) => {
      try { res.json(await schedulingService.saveScheduleInputs(req.user, req.params.id, req.body)); }
      catch (error) { sendError(res, error, 'Failed to save Semester and availability.'); }
    });
    router.post('/courses/:id/timetable/propose', requireD09Ready, async (req, res) => {
      try { res.status(201).json(await schedulingService.proposeTimetable(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to calculate a feasible timetable.'); }
    });
    router.put('/courses/:id/timetable', requireD09Ready, async (req, res) => {
      try { res.json(await schedulingService.editTimetable(req.user, req.params.id, req.body)); }
      catch (error) { sendError(res, error, 'Timetable edit was not feasible.'); }
    });
    router.get('/calendar', requireD09Ready, async (req, res) => {
      try { res.json(await schedulingService.getCalendar(req.user, {
        from: req.query.from || null,
        to: req.query.to || null,
        currentTimeZone: req.query.currentTimeZone || 'UTC',
      })); }
      catch (error) { sendError(res, error, 'Failed to load Teaching Calendar.'); }
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
