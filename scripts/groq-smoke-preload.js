'use strict';

const path = require('path');

const enabled = String(process.env.AI_GROQ_SMOKE_ON_START || '').trim() === '1';
const entrypoint = path.basename(process.argv[1] || '');

// This module is intended for a temporary Render qualification deploy via
// NODE_OPTIONS=--require=./scripts/groq-smoke-preload.js. It must not run during
// npm/postinstall/build subprocesses and it never changes normal AI routing.
if (enabled && entrypoint === 'index.js') {
  const { runGroqSmoke, safeFailure } = require('./smoke-groq-runtime');
  const launch = typeof setImmediate === 'function'
    ? setImmediate
    : (fn) => setTimeout(fn, 0);

  launch(() => {
    runGroqSmoke()
      .catch((error) => {
        console.error('[KIWI AIM-D02] startup Groq smoke failed', safeFailure(error));
      });
  });
}
