'use strict';

/**
 * Historical model records retained for audit/rollback context only.
 * This module is intentionally not consumed by production routing.
 */
const HISTORICAL_MODELS = Object.freeze([
  Object.freeze({ provider: 'GOOGLE', modelId: 'gemini-3.7-flash', family: 'FLASH', retiredFromActiveRouting: true }),
  Object.freeze({ provider: 'GOOGLE', modelId: 'gemini-3.6-flash', family: 'FLASH', retiredFromActiveRouting: true }),
  Object.freeze({ provider: 'GROQ', modelId: 'openai/gpt-oss-120b', family: null, retiredFromActiveRouting: true }),
  Object.freeze({ provider: 'GROQ', modelId: 'openai/gpt-oss-20b', family: null, retiredFromActiveRouting: true }),
]);

module.exports = { HISTORICAL_MODELS };
