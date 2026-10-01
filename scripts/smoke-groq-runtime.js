'use strict';

const { AI_PROVIDERS } = require('../services/ai/providers');
const { createModelCatalog, MODEL_STATUS } = require('../services/ai/model-catalog');

const catalog = createModelCatalog();
const groqRoutes = catalog.list({ provider: AI_PROVIDERS.GROQ, status: MODEL_STATUS.APPROVED, productionEligible: true });
if (!groqRoutes.length || groqRoutes.some((route) => !route.routeKey)) {
  throw new Error('Neutral provider smoke failed: no routable GROQ catalog entries');
}
console.log('[KIWI AI] neutral provider smoke passed', groqRoutes.map((route) => route.routeKey));
