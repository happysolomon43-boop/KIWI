'use strict';

const { ReckoningContractError } = require('./errors');

function parseReview(text) {
  const raw = String(text || '').trim()
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new ReckoningContractError('Semantic review returned no JSON object.');
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new ReckoningContractError(`Invalid semantic-review JSON: ${error.message}`);
  }
}

function createAISemanticReviewer({ aiRun } = {}) {
  if (typeof aiRun !== 'function') {
    throw new ReckoningContractError('AI semantic reviewer requires the centralized AI runner.');
  }

  return async function semanticReview({
    question,
    blueprint,
    sourceSnapshot,
    previousQuestion = null,
  }) {
    const prompt = [
      'Audit one KIWI Reckoning question for assessment integrity.',
      'Return JSON only with keys: valid, grounded, singleBestAnswer, variantDistinct, issues.',
      'valid must be true only if every required condition is satisfied.',
      'grounded: the correct answer is supported by the supplied source and no unsupported fact is required.',
      'singleBestAnswer: exactly one option is defensibly best.',
      'variantDistinct: for Challenge/Confirmation, it is not merely a paraphrase of the previous question.',
      `ROLE: ${blueprint?.role || 'UNKNOWN'}`,
      'SOURCE:',
      JSON.stringify(sourceSnapshot || {}),
      'QUESTION:',
      JSON.stringify(question || {}),
      'PREVIOUS QUESTION:',
      JSON.stringify(previousQuestion || null),
    ].join('\n');

    const result = await aiRun('CBT_QUESTION_AUDIT', {
      content: prompt,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const parsed = parseReview(result?.text);
    return {
      valid: parsed.valid === true,
      grounded: parsed.grounded === true,
      singleBestAnswer: parsed.singleBestAnswer === true,
      variantDistinct: parsed.variantDistinct !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      modelId: result?.modelId || null,
    };
  };
}

module.exports = {
  parseReview,
  createAISemanticReviewer,
};
