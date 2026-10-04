'use strict';

const crypto = require('node:crypto');
const { D27_KNOWLEDGE_TYPES, assertUnprotectedPrivacy } = require('./contracts');

const CARD_NATIVE_KNOWLEDGE_TYPES = Object.freeze(['DECLARATIVE', 'CONCEPTUAL']);
const FRESH_PRACTICE_KNOWLEDGE_TYPES = Object.freeze(['PROCEDURAL', 'ANALYTICAL', 'INTERPRETIVE', 'PRODUCTION']);
const STOP_WORDS = new Set(['the','and','for','with','from','that','this','into','your','their','then','than','what','when','where','which','while','about','using','use','can','will','are','was','were','has','have','had']);

function requiredText(value, name) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new TypeError(`${name} is required.`);
  return text;
}

function normalizeKnowledgeType(value) {
  const type = requiredText(value, 'knowledgeType').toUpperCase();
  if (!D27_KNOWLEDGE_TYPES.includes(type)) {
    const error = new Error(`Unsupported knowledge type: ${type}`);
    error.code = 'TEACHING_D27_KNOWLEDGE_TYPE_INVALID';
    error.status = 400;
    throw error;
  }
  return type;
}

function tokens(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) || []);
}

function overlapScore(queryTokens, card) {
  const candidate = tokens(`${card.front_content || card.front || ''} ${card.back_content || card.back || ''} ${card.tags ? JSON.stringify(card.tags) : ''}`);
  if (!queryTokens.size || !candidate.size) return 0;
  let overlap = 0;
  for (const token of queryTokens) if (candidate.has(token)) overlap += 1;
  return overlap / Math.max(1, Math.min(queryTokens.size, candidate.size));
}

function cardVersion(card) {
  const raw = card.updated_at || card.updatedAt || card.version || card.created_at || card.createdAt;
  return raw instanceof Date ? raw.toISOString() : requiredText(raw, 'card version');
}

function selectExistingCardReferences({ cards, knowledgeType, learningUnitTitle, intendedCompetence, limit = 5 }) {
  const type = normalizeKnowledgeType(knowledgeType);
  if (FRESH_PRACTICE_KNOWLEDGE_TYPES.includes(type)) {
    return Object.freeze({
      knowledgeType: type,
      references: Object.freeze([]),
      freshPracticeRecommended: true,
      reason: 'KNOWLEDGE_TYPE_REQUIRES_FRESH_APPLICATION_OR_PRODUCTION',
    });
  }
  const queryTokens = tokens(`${learningUnitTitle || ''} ${intendedCompetence || ''}`);
  const ranked = (Array.isArray(cards) ? cards : [])
    .filter((card) => card && card.id && card.archived !== true)
    .map((card) => ({ card, score: overlapScore(queryTokens, card) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.card.id).localeCompare(String(b.card.id)))
    .slice(0, Math.max(0, Math.min(12, Number(limit) || 5)))
    .map(({ card, score }) => Object.freeze({
      cardId: String(card.id),
      cardVersion: cardVersion(card),
      knowledgeType: type,
      relevanceReason: `DETERMINISTIC_LEARNING_UNIT_OVERLAP:${score.toFixed(3)}`,
    }));
  return Object.freeze({
    knowledgeType: type,
    references: Object.freeze(ranked),
    freshPracticeRecommended: false,
    reason: ranked.length ? 'RELEVANT_EXISTING_CARDS_FOUND' : 'NO_RELEVANT_EXISTING_CARD_FOUND',
  });
}

function assertCandidateProvenance(provenanceRefs) {
  if (!Array.isArray(provenanceRefs) || provenanceRefs.length === 0) throw new TypeError('candidate provenanceRefs must contain at least one approved source reference.');
  for (const ref of provenanceRefs) {
    if (!ref || typeof ref !== 'object') throw new TypeError('candidate provenance reference must be an object.');
    const protection = String(ref.protectionClass || ref.contentClass || 'C1').toUpperCase();
    assertUnprotectedPrivacy(protection);
    if (ref.protectedAssessment === true || ref.answerKey === true || ref.formalCandidate === true) {
      const error = new Error('Protected/formal Assessment material cannot become a Study card candidate.');
      error.code = 'TEACHING_D27_ASSESSMENT_TO_CARD_FORBIDDEN';
      error.status = 400;
      throw error;
    }
  }
}

function buildValidatedCardCandidate(input) {
  if (!input || typeof input !== 'object') throw new TypeError('card candidate input is required.');
  const type = normalizeKnowledgeType(input.knowledgeType);
  if (!CARD_NATIVE_KNOWLEDGE_TYPES.includes(type)) {
    const error = new Error(`${type} Learning Units require fresh practice rather than automatic card candidates.`);
    error.code = 'TEACHING_D27_CARD_CANDIDATE_UNSUITABLE';
    error.status = 409;
    throw error;
  }
  assertUnprotectedPrivacy(input.privacyClass || 'C1');
  assertCandidateProvenance(input.provenanceRefs);
  const validation = input.validation || {};
  if (String(validation.status || '').toUpperCase() !== 'PASS' || validation.independent !== true) {
    const error = new Error('A missing-card candidate must pass independent validation before Teaching can persist it as VALIDATED.');
    error.code = 'TEACHING_D27_CARD_VALIDATION_REQUIRED';
    error.status = 409;
    throw error;
  }
  const frontContent = requiredText(input.frontContent, 'frontContent');
  const backContent = requiredText(input.backContent, 'backContent');
  const contentHash = crypto.createHash('sha256').update(`${frontContent.trim()}\n---\n${backContent.trim()}`).digest('hex');
  return Object.freeze({
    candidateId: requiredText(input.candidateId, 'candidateId'),
    studentId: requiredText(input.studentId, 'studentId'),
    courseId: requiredText(input.courseId, 'courseId'),
    classId: requiredText(input.classId, 'classId'),
    learningUnitId: requiredText(input.learningUnitId, 'learningUnitId'),
    subjectId: requiredText(input.subjectId, 'subjectId'),
    knowledgeType: type,
    frontContent,
    backContent,
    contentHash,
    provenanceRefs: Object.freeze(input.provenanceRefs.map((ref) => Object.freeze({ ...ref }))),
    sourceVersion: requiredText(input.sourceVersion, 'sourceVersion'),
    validation: Object.freeze({ ...validation }),
    status: 'VALIDATED',
    createdAt: requiredText(input.createdAt, 'createdAt'),
    updatedAt: requiredText(input.updatedAt || input.createdAt, 'updatedAt'),
  });
}

module.exports = {
  CARD_NATIVE_KNOWLEDGE_TYPES,
  FRESH_PRACTICE_KNOWLEDGE_TYPES,
  normalizeKnowledgeType,
  selectExistingCardReferences,
  buildValidatedCardCandidate,
};
