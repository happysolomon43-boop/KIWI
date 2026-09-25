'use strict';

const express = require('express');

function createTeachingRouter({ authenticate, reckoningLockout } = {}) {
  if (typeof authenticate !== 'function') {
    throw new TypeError('KIWI Teaching backend requires the existing authenticate middleware.');
  }

  const router = express.Router();

  router.use(authenticate);
  if (typeof reckoningLockout === 'function') {
    router.use(reckoningLockout);
  }

  // Baseline endpoint only. Teaching capabilities will be added behind this router.
  router.get('/status', (req, res) => {
    res.json({
      ok: true,
      mode: 'teaching',
      status: 'baseline-ready',
    });
  });

  return router;
}

module.exports = {
  createTeachingRouter,
};
