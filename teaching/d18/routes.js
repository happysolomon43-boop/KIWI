'use strict';

const { createD18AssessmentShellService } = require('./service');

function mountD18Routes(router, { foundation, sendError, requireD17Ready = null } = {}) {
  const repository = foundation?.d17?.repository;
  if (!repository) return null;
  const service = createD18AssessmentShellService({ repository });
  const requireReady = typeof requireD17Ready === 'function'
    ? requireD17Ready
    : async (_req, res, next) => {
        try { await repository.assertReady(); return next(); }
        catch (error) { return res.status(503).json({ error:'Assessment Shell is unavailable until the D17 schema is ready.', code:error?.code || 'TEACHING_D17_SCHEMA_NOT_READY' }); }
      };

  router.use('/assessment-shell', requireReady);
  router.get('/assessment-shell/packages/:packageId', async (req, res) => {
    try { res.json(await service.getPackage(req.user, req.params.packageId)); }
    catch (error) { sendError(res, error, 'Failed to load Assessment Shell package.'); }
  });
  router.get('/assessment-shell/attempts/:attemptId', async (req, res) => {
    try { res.json(await service.getAttemptWorkspace(req.user, req.params.attemptId, { deviceId:req.query.deviceId || null })); }
    catch (error) { sendError(res, error, 'Failed to restore Assessment Attempt workspace.'); }
  });
  return Object.freeze({ service, requireReady });
}

module.exports = { mountD18Routes };
