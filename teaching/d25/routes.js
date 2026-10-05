'use strict';

function mountD25Routes(router, { service, sendError } = {}) {
  if (!service) return null;
  router.get('/reliability/status', (req, res) => res.json(service.status()));
  router.get('/reliability/classes/:classId', async (req, res) => {
    try { res.json(await service.restoreClass(req.user, req.params.classId)); }
    catch (error) { sendError(res, error, 'Failed to restore the authoritative Class session.'); }
  });
  router.post('/reliability/classes/:classId/technical-issue', async (req, res) => {
    try { res.status(201).json(await service.recordStudentTechnicalIssue(req.user, req.params.classId, req.body || {})); }
    catch (error) { sendError(res, error, 'Failed to record the technical issue.'); }
  });
  router.get('/reliability/attempts/:attemptId', async (req, res) => {
    try {
      res.json(await service.assessmentRecovery(req.user, req.params.attemptId, {
        deviceId: req.query.deviceId || null,
        connected: req.query.connected !== 'false',
        localDraftPresent: req.query.localDraftPresent === 'true',
      }));
    } catch (error) { sendError(res, error, 'Failed to restore the authoritative Assessment Attempt.'); }
  });
  router.get('/reliability/assignments/:assignmentId', async (req, res) => {
    try { res.json(await service.restoreAssignment(req.user, req.params.assignmentId)); }
    catch (error) { sendError(res, error, 'Failed to restore the authoritative Assignment state.'); }
  });
  return Object.freeze({ service });
}

module.exports = { mountD25Routes };
