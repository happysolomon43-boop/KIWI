'use strict';

if (String(process.env.AI_GPT_OSS_CBT_EXPERIMENT_ON_START || '') === '1') {
  const { runGptOssCbtExperiment } = require('./run-gpt-oss-cbt-experiment');
  Promise.resolve()
    .then(() => runGptOssCbtExperiment())
    .catch((error) => {
      console.error('[KIWI GPT-OSS 120B CBT EXPERIMENT] PRELOAD_FAILED', {
        code: error?.code || 'UNKNOWN',
        provider: error?.provider || null,
        status: error?.status || null,
        message: String(error?.message || error).slice(0, 500),
      });
    });
}
