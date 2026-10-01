'use strict';

const express = require('express');
const { createTeachingFoundation } = require('./teaching');
const { mountD15Routes } = require('./teaching/d15/routes');
const { mountD16Routes } = require('./teaching/d16/routes');

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
  d10Service = null,
  d11Intelligence = null,
  d11Service = null,
  d11PublishedEventRegistry = null,
  d12Intelligence = null,
  d12Service = null,
  d12PublishedEventRegistry = null,
  d13Intelligence = null,
  d13Service = null,
  d13PublishedEventRegistry = null,
  d16Intelligence = null,
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
    d10RuntimePlatform: teachingRuntimePlatform || null,
    d11Intelligence,
    d11PublishedEventRegistry,
    d12Intelligence,
    d12PublishedEventRegistry,
    d13Intelligence,
    d13PublishedEventRegistry,
    d16Intelligence,
  });
  const router = express.Router();
  let d07Ready = Boolean(d07Service);
  let d08Ready = Boolean(d08Service);
  let d09Ready = Boolean(d09Service);
  let d10Ready = Boolean(d10Service);
  let d11Ready = Boolean(d11Service);
  let d12Ready = Boolean(d12Service);
  let d13Ready = Boolean(d13Service);
  let d14Ready = false;

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

  router.assertD10Ready = async () => {
    if (!foundation.d10?.repository) {
      d10Ready = false;
      return false;
    }
    await foundation.d10.repository.assertReady();
    d10Ready = true;
    return true;
  };

  router.assertD11Ready = async () => {
    if (!foundation.d11?.repository) {
      d11Ready = false;
      return false;
    }
    await foundation.d11.repository.assertReady();
    d11Ready = true;
    return true;
  };

  router.assertD12Ready = async () => {
    const repo12 = foundation.d12?.repository || d12Service?.repository || null;
    if (!repo12 || typeof repo12.assertReady !== 'function') {
      d12Ready = false;
      return false;
    }
    await repo12.assertReady();
    d12Ready = true;
    return true;
  };

  router.assertD13Ready = async () => {
    const repo13 = foundation.d13?.repository || d13Service?.repository || null;
    if (!repo13 || typeof repo13.assertReady !== 'function') {
      d13Ready = false;
      return false;
    }
    await repo13.assertReady();
    d13Ready = true;
    return true;
  };
  router.assertD14Ready = async () => {
    if (!foundation.d14?.repository) return false;
    await foundation.d14.repository.assertReady();
    d14Ready = true;
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

  const lifecycleRequestService = d10Service || foundation.d10?.service || null;
  if (lifecycleRequestService) {
    const requireD10Ready = (req, res, next) => {
      if (d10Ready) return next();
      return res.status(503).json({
        error: 'Teaching Course activation and Requests are unavailable until the D10 schema is ready.',
        code: 'TEACHING_D10_SCHEMA_NOT_READY',
      });
    };
    router.get('/teacher-identities', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.listTeacherIdentities(req.user)); }
      catch (error) { sendError(res, error, 'Failed to load available Teacher identities.'); }
    });
    router.get('/courses/:id/academic-rules', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.getAcademicRules(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load academic rules and Teacher.'); }
    });
    router.post('/courses/:id/academic-rules/prepare', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.prepareAcademicRules(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Failed to prepare academic rules and Teacher.'); }
    });
    router.get('/courses/:id/activation-review', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.getActivationReview(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load final activation review.'); }
    });
    router.post('/courses/:id/ready', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.markReady(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Course could not become Ready.'); }
    });
    router.post('/courses/:id/activate', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.activateCourse(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Course activation failed safely.'); }
    });
    router.post('/courses/:id/incomplete/archive', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.archiveIncomplete(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Incomplete Course could not be administratively closed.'); }
    });
    router.get('/requests', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.listRequests(req.user, { courseId:req.query.courseId || null, state:req.query.state || null })); }
      catch (error) { sendError(res, error, 'Failed to load Teaching Requests.'); }
    });
    router.post('/requests', requireD10Ready, async (req, res) => {
      try { res.status(201).json(await lifecycleRequestService.createRequest(req.user, req.body || {})); }
      catch (error) { sendError(res, error, 'Teaching Request could not be created.'); }
    });
    router.get('/requests/:id', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.getRequest(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Teaching Request.'); }
    });
    router.post('/requests/:id/submit', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.submitRequest(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Teaching Request could not be submitted.'); }
    });
    router.post('/requests/:id/review', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.reviewRequest(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Teaching Request review failed safely.'); }
    });
    router.post('/requests/:id/withdraw', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.withdrawRequest(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Teaching Request could not be withdrawn.'); }
    });
    router.post('/requests/:id/alternative/accept', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.acceptAlternative(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Alternative proposal could not be accepted.'); }
    });
    router.post('/requests/:id/alternative/decline', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.declineAlternative(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Alternative proposal could not be declined.'); }
    });
    router.post('/requests/:id/apply', requireD10Ready, async (req, res) => {
      try { res.json(await lifecycleRequestService.applyRequest(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Approved Request could not be applied.'); }
    });
  }

  const lessonControllerService = d11Service || foundation.d11?.service || null;
  if (lessonControllerService) {
    const requireD11Ready = (req, res, next) => {
      if (d11Ready) return next();
      return res.status(503).json({
        error: 'Teaching Lesson Blueprint and Controller are unavailable until the D11 schema is ready.',
        code: 'TEACHING_D11_SCHEMA_NOT_READY',
      });
    };
    router.get('/classes/:id/controller', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.getClass(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Teaching Controller state.'); }
    });
    router.post('/classes/:id/lesson-blueprint/prepare', requireD11Ready, async (req, res) => {
      try { res.status(201).json(await lessonControllerService.prepareLesson(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Lesson Blueprint preparation failed safely.'); }
    });
    router.post('/classes/:id/controller/start', requireD11Ready, async (req, res) => {
      try { res.status(201).json(await lessonControllerService.startController(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Class Controller could not start.'); }
    });
    router.post('/classes/:id/controller/transition', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.transition(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Controller transition failed safely.'); }
    });
    router.post('/classes/:id/controller/cycle/advance', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.advanceInstructionCycle(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Instruction cycle transition failed safely.'); }
    });
    router.post('/classes/:id/controller/evidence-descriptor', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.setEvidenceDescriptor(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Evidence descriptor update failed safely.'); }
    });
    router.post('/classes/:id/controller/progress', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.recordProgress(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Controller progress update failed safely.'); }
    });
    router.post('/classes/:id/controller/break', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.startBreak(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Class break could not start.'); }
    });
    router.post('/classes/:id/controller/overtime', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.authorizeOvertime(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Class overtime could not be authorized.'); }
    });
    router.post('/classes/:id/controller/replan', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.replanLesson(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Live Lesson replanning failed safely.'); }
    });
    router.post('/classes/:id/controller/close', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.closeClass(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Class Closure failed safely.'); }
    });
    router.get('/classes/:id/summary', requireD11Ready, async (req, res) => {
      try { res.json(await lessonControllerService.getSummary(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Class Summary.'); }
    });
  }

  const classroomService = foundation.d14?.service || null;
  if (classroomService) {
    const requireD14Ready = async (_req,res,next) => {
      if(d14Ready)return next();
      try{await router.assertD14Ready();return next();}
      catch{return res.status(503).json({error:'Classroom artifacts are unavailable until the D14 schema is ready.',code:'TEACHING_D14_SCHEMA_NOT_READY'});}
    };
    router.get('/courses/:id/classes',requireD14Ready,async(req,res)=>{
      try{res.json(await classroomService.listClasses(req.user,req.params.id));}catch(error){sendError(res,error,'Could not load Classes.');}
    });
    router.get('/classes/:id/classroom',requireD14Ready,async(req,res)=>{
      try{res.json(await classroomService.snapshot(req.user,req.params.id));}catch(error){sendError(res,error,'Could not load Classroom.');}
    });
    router.post('/classes/:id/classroom/enter',requireD14Ready,async(req,res)=>{
      try{res.json(await classroomService.enter(req.user,req.params.id));}catch(error){sendError(res,error,'Could not enter Classroom.');}
    });
    router.post('/classes/:id/notebook',requireD14Ready,async(req,res)=>{
      try{res.status(201).json(await classroomService.notebook(req.user,req.params.id,req.body||{}));}catch(error){sendError(res,error,'Could not save Notebook item.');}
    });
    router.post('/classes/:id/interactions',requireD14Ready,async(req,res)=>{
      try{res.status(201).json(await classroomService.signal(req.user,req.params.id,req.body||{}));}catch(error){sendError(res,error,'Could not record Classroom interaction.');}
    });
    router.post('/classes/:id/classroom/responses',requireD14Ready,async(req,res)=>{
      try{res.status(201).json(await classroomService.respond(req.user,req.params.id,req.body||{}));}catch(error){sendError(res,error,'Could not capture Classroom response.');}
    });
  }

  // D15 exposes reporting/recovery-inspection projections only. Attendance
  // mutation remains behind the D10 Request owner or trusted server runtime.
  mountD15Routes(router,{foundation,sendError});

  // D16 mounts the authoritative Work projections and student intents. The
  // Assignment/Submission owner remains server-side; browser state never owns
  // deadlines, policy versions, integrity outcomes or final submission time.
  mountD16Routes(router,{foundation,sendError});

  const studentKnowledgeModelService = d13Service || foundation.d13?.service || null;
  if (studentKnowledgeModelService) {
    const requireD13Ready = (req, res, next) => {
      if (d13Ready) return next();
      return res.status(503).json({
        error: 'Teaching Student Knowledge Model is unavailable until the D13 schema is ready.',
        code: 'TEACHING_D13_SCHEMA_NOT_READY',
      });
    };
    router.get('/learning-analysis', requireD13Ready, async (req, res) => {
      try {
        const courseId = String(req.query.courseId || '').trim();
        if (!courseId) return res.status(400).json({ error:'courseId is required.', code:'TEACHING_D13_COURSE_ID_REQUIRED' });
        res.json(await studentKnowledgeModelService.getCourseLearningAnalysis(req.user, courseId));
      } catch (error) { sendError(res, error, 'Failed to load Learning Analysis.'); }
    });
    router.get('/learning-units/:id/learning-analysis', requireD13Ready, async (req, res) => {
      try { res.json(await studentKnowledgeModelService.getLearningAnalysis(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Learning Unit analysis.'); }
    });
  }

  const responsePedagogyService = d12Service || foundation.d12?.service || null;
  if (responsePedagogyService) {
    const requireD12Ready = (req, res, next) => {
      if (d12Ready) return next();
      return res.status(503).json({
        error: 'Teaching Response Evaluation and Pedagogy are unavailable until the D12 schema is ready.',
        code: 'TEACHING_D12_SCHEMA_NOT_READY',
      });
    };
    router.post('/classes/:id/responses', requireD12Ready, async (req, res) => {
      try { res.status(201).json(await responsePedagogyService.captureResponse(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Student response could not be captured safely.'); }
    });
    router.get('/responses/:id/evaluation', requireD12Ready, async (req, res) => {
      try { res.json(await responsePedagogyService.getResponseEvaluation(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load response evaluation.'); }
    });
    router.post('/response-evaluations/:evaluationId/pedagogy', requireD12Ready, async (req, res) => {
      try {
        const classId = String(req.body?.classId || '').trim();
        if (!classId) return res.status(400).json({ error:'classId is required.', code:'TEACHING_D12_CLASS_ID_REQUIRED' });
        res.status(201).json(await responsePedagogyService.recommendPedagogy(req.user, classId, req.params.evaluationId, req.body || {}));
      } catch (error) { sendError(res, error, 'Pedagogy decision could not be produced safely.'); }
    });
    router.post('/classes/:id/productive-struggle', requireD12Ready, async (req, res) => {
      try { res.json(await responsePedagogyService.analyzeProductiveStruggle(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Productive-struggle decision failed safely.'); }
    });
    router.post('/classes/:id/teacher-correction', requireD12Ready, async (req, res) => {
      try { res.status(201).json(await responsePedagogyService.analyzeTeacherCorrection(req.user, req.params.id, req.body || {})); }
      catch (error) { sendError(res, error, 'Teacher self-correction analysis failed safely.'); }
    });
    router.post('/classes/:classId/learning-units/:id/pedagogy-profile', requireD12Ready, async (req, res) => {
      try { res.status(201).json(await responsePedagogyService.classifyPedagogyProfile(req.user, req.params.classId, req.params.id)); }
      catch (error) { sendError(res, error, 'Learning Unit Pedagogical Profile classification failed safely.'); }
    });
    router.get('/learning-units/:id/pedagogy-profile', requireD12Ready, async (req, res) => {
      try { res.json(await responsePedagogyService.getPedagogyProfile(req.user, req.params.id)); }
      catch (error) { sendError(res, error, 'Failed to load Learning Unit Pedagogical Profile.'); }
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
