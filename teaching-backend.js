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
  });
  const router = express.Router();

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
