'use strict';

const { createD07Intelligence } = require('../d07/intelligence');
const { createD08Intelligence } = require('../d08/intelligence');
const { createD09Intelligence } = require('../d09/intelligence');
const { createD11Intelligence } = require('../d11/intelligence');
const { createD12Intelligence } = require('../d12/intelligence');
const { createD13Intelligence } = require('../d13/intelligence');
const { createD16Intelligence } = require('../d16/intelligence');
const { createD17Intelligence } = require('../d17/intelligence');
const { resolveOwnerReleaseAuthorization } = require('./owner-release-override');

const ADAPTER_KEYS = Object.freeze([
  'd07Intelligence',
  'd08Intelligence',
  'd09Intelligence',
  'd11Intelligence',
  'd12Intelligence',
  'd13Intelligence',
  'd16Intelligence',
  'd17Intelligence',
]);

function heldIntelligence() {
  return Object.freeze(Object.fromEntries(ADAPTER_KEYS.map((key) => [key, null])));
}

function assertCentralBoundary(runtimePlatform) {
  const boundary = runtimePlatform?.aiBoundary;
  if (!boundary || typeof boundary.execute !== 'function') {
    const error = new TypeError('D31 AI release wiring requires the Teaching central AI execution boundary.');
    error.code = 'TEACHING_D31_CENTRAL_AI_BOUNDARY_REQUIRED';
    throw error;
  }
  return boundary;
}

function createD31ReleaseIntelligence({ runtimePlatform, env = process.env } = {}) {
  const authorization = resolveOwnerReleaseAuthorization(env);
  if (!authorization.enabled) {
    return Object.freeze({
      authorization,
      intelligence: heldIntelligence(),
      enabledAdapterKeys: Object.freeze([]),
    });
  }

  const orchestrator = assertCentralBoundary(runtimePlatform);
  const intelligence = Object.freeze({
    d07Intelligence: createD07Intelligence({ orchestrator }),
    d08Intelligence: createD08Intelligence({ orchestrator }),
    d09Intelligence: createD09Intelligence({ orchestrator }),
    d11Intelligence: createD11Intelligence({ orchestrator }),
    d12Intelligence: createD12Intelligence({ orchestrator }),
    d13Intelligence: createD13Intelligence({ orchestrator }),
    d16Intelligence: createD16Intelligence({ orchestrator }),
    d17Intelligence: createD17Intelligence({ orchestrator }),
  });

  return Object.freeze({
    authorization,
    intelligence,
    enabledAdapterKeys: ADAPTER_KEYS,
  });
}

module.exports = Object.freeze({
  ADAPTER_KEYS,
  createD31ReleaseIntelligence,
});
