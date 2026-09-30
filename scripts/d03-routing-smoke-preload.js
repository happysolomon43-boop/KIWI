'use strict';

const path = require('path');

const enabled = String(process.env.AI_D03_SMOKE_ON_START || '').trim() === '1';
const entrypoint = path.basename(process.argv[1] || '');

// Temporary Render qualification hook only. It runs beside the normal server,
// never exposes an endpoint, and cannot change feature routing by itself.
// AI_TEXT_PROVIDER_MODE remains the central operational rollout/rollback switch.
if (enabled && entrypoint === 'index.js') {
  const { runD03RoutingSmoke, safeError } = require('./smoke-d03-routing');
  const launch = typeof setImmediate === 'function'
    ? setImmediate
    : (fn) => setTimeout(fn, 0);

  launch(() => {
    runD03RoutingSmoke()
      .catch((error) => {
        console.error('[KIWI AIM-D03] startup routing smoke failed', safeError(error));
      });
  });
}
