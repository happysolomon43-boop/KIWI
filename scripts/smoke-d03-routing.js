'use strict';

const { createModelRouter } = require('../services/ai/model-router');

const router = createModelRouter();
const plan = router.resolveCandidates('MAIN_CBT');
if (!plan.length || plan.some((candidate) => !candidate.routeKey || !candidate.provider || !candidate.modelId)) {
  throw new Error('Neutral routing smoke failed: MAIN_CBT has no valid provider/model routes');
}
console.log('[KIWI AI] neutral routing smoke passed', plan.map((candidate) => candidate.routeKey));
