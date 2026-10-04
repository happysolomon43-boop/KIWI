'use strict';

function mountD27Routes(router, { service, repository, sendError } = {}) {
  if (!router || !service || !repository) return null;
  let ready = false;
  const requireReady = async (_req, res, next) => {
    try {
      if (!ready) {
        await repository.assertReady();
        ready = true;
      }
      return next();
    } catch (error) {
      return res.status(503).json({
        error:'Teaching integrations are unavailable until the D27 schema is ready.',
        code:error?.code || 'TEACHING_D27_SCHEMA_NOT_READY',
      });
    }
  };

  router.use('/integrations', requireReady);

  router.get('/integrations/status', (_req, res) => res.json(service.status()));
  router.get('/integrations/courses/:courseId/subject', async (req, res) => {
    try { res.json(await service.subjectBoundary(req.user, req.params.courseId)); }
    catch (error) { sendError(res, error, 'Failed to inspect Subject integration boundary.'); }
  });
  router.post('/integrations/assessment-shell/handoff', async (req, res) => {
    try { res.json(await service.assessmentShellHandoff(req.user, req.body || {})); }
    catch (error) { sendError(res, error, 'Failed to build shared Assessment Shell handoff.'); }
  });
  router.post('/integrations/events', async (req, res) => {
    try { res.status(201).json(await service.publishEvent(req.user, req.body || {})); }
    catch (error) { sendError(res, error, 'Failed to publish Teaching integration event.'); }
  });
  router.post('/integrations/events/:eventId/dispatch', async (req, res) => {
    try { res.json(await service.dispatchEvent(req.user, req.params.eventId, req.body || {})); }
    catch (error) { sendError(res, error, 'Failed to dispatch Teaching integration event.'); }
  });
  router.post('/integrations/events/:eventId/knowledge-score', async (req, res) => {
    try { res.json(await service.applyKnowledgeScore(req.user, req.params.eventId)); }
    catch (error) { sendError(res, error, 'Knowledge Score integration was not applied.'); }
  });
  router.post('/integrations/events/:eventId/mastery', async (req, res) => {
    try { res.json(await service.applyMasterySignal(req.user, req.params.eventId)); }
    catch (error) { sendError(res, error, 'Mastery integration was not applied.'); }
  });
  router.post('/integrations/study/review-set', async (req, res) => {
    try { res.json(await service.prepareClassReviewSet(req.user, req.body || {})); }
    catch (error) { sendError(res, error, 'Failed to prepare Class Review Set.'); }
  });
  router.get('/integrations/study/review-set', async (req, res) => {
    try { res.json(await service.getClassReviewSet(req.user, req.query || {})); }
    catch (error) { sendError(res, error, 'Failed to load Class Review Set.'); }
  });
  router.post('/integrations/study/candidates/:candidateId/dismiss', async (req, res) => {
    try { res.json(await service.dismissStudyCandidate(req.user, req.params.candidateId, req.body?.expectedVersion)); }
    catch (error) { sendError(res, error, 'Failed to dismiss Study card candidate.'); }
  });
  router.post('/integrations/study/candidates/:candidateId/promote', async (req, res) => {
    try { res.json(await service.promoteStudyCandidate(req.user, req.params.candidateId, req.body?.expectedVersion, req.body || {})); }
    catch (error) { sendError(res, error, 'Failed to promote Study card candidate.'); }
  });

  return Object.freeze({ requireReady });
}

module.exports = { mountD27Routes };
