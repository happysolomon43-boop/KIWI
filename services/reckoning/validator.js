'use strict';

const { createReckoningConfig } = require('./config');

const OPTION_KEYS = Object.freeze(['A', 'B', 'C', 'D']);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function jaccardSimilarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function normalizeQuestion(question = {}) {
  const stem = String(question.stem || question.question || '').trim();
  let options = question.options;

  if (!Array.isArray(options)) {
    options = OPTION_KEYS.map((key) => question[`option_${key.toLowerCase()}`]);
  }
  options = options.map((value) => String(value ?? '').trim());

  let correctIndex = Number.isInteger(question.correctIndex)
    ? question.correctIndex
    : null;
  if (correctIndex == null && Number.isInteger(question.correct_index)) {
    correctIndex = question.correct_index;
  }
  const answerLetter = String(
    question.correctAnswer ||
    question.correct_answer ||
    ''
  ).trim().toUpperCase();
  if (correctIndex == null && OPTION_KEYS.includes(answerLetter)) {
    correctIndex = OPTION_KEYS.indexOf(answerLetter);
  }

  return {
    stem,
    options,
    correctIndex,
    explanation: String(question.explanation || '').trim(),
  };
}

function createQuestionValidator({
  config = createReckoningConfig(),
  semanticReview = null,
} = {}) {
  function validateStructure(question, { blueprint = null, previousQuestion = null } = {}) {
    const normalized = normalizeQuestion(question);
    const issues = [];

    if (normalized.stem.length < config.validation.minStemLength) {
      issues.push('stem_too_short');
    }
    if (normalized.options.length !== 4) {
      issues.push('must_have_four_options');
    }

    const normalizedOptions = normalized.options.map(normalizeText);
    if (normalizedOptions.some((value) => !value)) {
      issues.push('blank_option');
    }
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      issues.push('duplicate_option');
    }

    for (const option of normalized.options) {
      if (config.validation.placeholderPatterns.some((pattern) => pattern.test(option))) {
        issues.push('placeholder_option');
        break;
      }
    }

    if (
      !Number.isInteger(normalized.correctIndex) ||
      normalized.correctIndex < 0 ||
      normalized.correctIndex > 3
    ) {
      issues.push('invalid_correct_answer');
    }

    if (blueprint?.role && question.role && String(question.role) !== String(blueprint.role)) {
      issues.push('role_mismatch');
    }

    if (previousQuestion && ['CHALLENGE', 'CONFIRMATION'].includes(blueprint?.role)) {
      const previousStem = normalizeQuestion(previousQuestion).stem;
      const similarity = jaccardSimilarity(previousStem, normalized.stem);
      if (
        normalizeText(previousStem) === normalizeText(normalized.stem) ||
        similarity > config.validation.maxStemSimilarity
      ) {
        issues.push('variant_too_similar');
      }
    }

    return Object.freeze({
      valid: issues.length === 0,
      issues: Object.freeze([...new Set(issues)]),
      normalized: Object.freeze(normalized),
      validatorVersion: config.validatorVersion,
    });
  }

  async function validateSemantics(question, context = {}) {
    if (typeof semanticReview !== 'function') {
      return Object.freeze({
        valid: false,
        reviewed: false,
        issues: Object.freeze(['semantic_review_unavailable']),
        validatorVersion: config.validatorVersion,
      });
    }

    const result = await semanticReview({
      question: normalizeQuestion(question),
      blueprint: context.blueprint || null,
      sourceSnapshot: context.sourceSnapshot || context.blueprint?.sourceSnapshot || null,
      previousQuestion: context.previousQuestion || null,
      generationGroupId: context.generationGroupId || null,
      operationBudgetId: context.operationBudgetId || null,
    });

    const issues = Array.isArray(result?.issues) ? result.issues.map(String) : [];
    const valid = result?.valid === true &&
      result?.grounded !== false &&
      result?.singleBestAnswer !== false &&
      result?.variantDistinct !== false;

    return Object.freeze({
      valid,
      reviewed: true,
      grounded: result?.grounded !== false,
      singleBestAnswer: result?.singleBestAnswer !== false,
      variantDistinct: result?.variantDistinct !== false,
      issues: Object.freeze(issues),
      validatorVersion: config.validatorVersion,
    });
  }

  return Object.freeze({
    name: 'reckoning-question-validator',
    version: config.validatorVersion,
    validateStructure,
    validateSemantics,
    normalizeQuestion,
    jaccardSimilarity,
  });
}

module.exports = {
  OPTION_KEYS,
  normalizeText,
  normalizeQuestion,
  jaccardSimilarity,
  createQuestionValidator,
};
