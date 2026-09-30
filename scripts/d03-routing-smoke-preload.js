'use strict';

const path = require('path');

const d03Enabled = String(process.env.AI_D03_SMOKE_ON_START || '').trim() === '1';
const cbtExperimentEnabled = String(process.env.AI_GPT_OSS_CBT_EXPERIMENT_ON_START || '').trim() === '1';
const entrypoint = path.basename(process.argv[1] || '');

// Temporary Render qualification hook only. It runs beside the normal server,
// never exposes an endpoint, and cannot change feature routing by itself.
// AI_TEXT_PROVIDER_MODE remains the central operational rollout/rollback switch.
if ((d03Enabled || cbtExperimentEnabled) && entrypoint === 'index.js') {
  const launch = typeof setImmediate === 'function'
    ? setImmediate
    : (fn) => setTimeout(fn, 0);

  if (d03Enabled) {
    const { runD03RoutingSmoke, safeError } = require('./smoke-d03-routing');
    launch(() => {
      runD03RoutingSmoke()
        .catch((error) => {
          console.error('[KIWI AIM-D03] startup routing smoke failed', safeError(error));
        });
    });
  }

  if (cbtExperimentEnabled) {
    const { runGptOssCbtExperiment } = require('./run-gpt-oss-cbt-experiment');
    launch(() => {
      runGptOssCbtExperiment()
        .catch((error) => {
          console.error('[KIWI GPT-OSS 120B CBT EXPERIMENT] startup experiment failed', {
            code: error?.code || 'UNKNOWN',
            provider: error?.provider || null,
            status: error?.status || null,
            message: String(error?.message || error).slice(0, 500),
          });
        });
    });
  }
}
