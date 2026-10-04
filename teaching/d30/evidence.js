'use strict';

const { assertNoHiddenChainOfThought } = require('./contracts');

const PROHIBITED_EVIDENCE_KEYS = Object.freeze(new Set([
  'chain_of_thought',
  'chainofthought',
  'hidden_reasoning',
  'hiddenreasoning',
  'reasoning_trace',
  'reasoningtrace',
  'private_scratchpad',
  'privatescratchpad',
  'scratchpad',
  'internal_monologue',
  'internalmonologue',
]));

function normalizedKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

function sanitizeOutputArtifact(value, { maxDepth = 20, maxStringLength = 120000 } = {}) {
  function visit(node, depth) {
    if (depth > maxDepth) {
      const error = new Error('D30 output artifact exceeded maximum reviewable nesting depth.');
      error.code = 'TEACHING_D30_OUTPUT_DEPTH_EXCEEDED';
      throw error;
    }
    if (node == null || typeof node === 'number' || typeof node === 'boolean') return node;
    if (typeof node === 'string') return node.length <= maxStringLength ? node : node.slice(0, maxStringLength);
    if (Array.isArray(node)) return Object.freeze(node.map((item) => visit(item, depth + 1)));
    if (typeof node !== 'object') return String(node);
    const output = {};
    for (const [key, item] of Object.entries(node)) {
      const normalized = normalizedKey(key);
      if (PROHIBITED_EVIDENCE_KEYS.has(normalized)) {
        const error = new Error(`D30 review artifact contains prohibited private-reasoning field: ${key}`);
        error.code = 'TEACHING_D30_HIDDEN_REASONING_FIELD_FORBIDDEN';
        throw error;
      }
      output[key] = visit(item, depth + 1);
    }
    return Object.freeze(output);
  }
  const sanitized = visit(value, 0);
  assertNoHiddenChainOfThought(sanitized);
  return sanitized;
}

function createReviewArtifact({ parsedOutput, rawText = '', caseSpec = {}, routeKey, modelId, provider } = {}) {
  const safeOutput = sanitizeOutputArtifact(parsedOutput == null ? { text:String(rawText || '') } : parsedOutput);
  return Object.freeze({
    caseId:String(caseSpec.id || ''),
    familyId:String(caseSpec.familyId || ''),
    capabilityId:caseSpec.capabilityId == null ? null : String(caseSpec.capabilityId),
    criticality:String(caseSpec.criticality || ''),
    routeKey:String(routeKey || ''),
    modelId:String(modelId || ''),
    provider:String(provider || ''),
    output:safeOutput,
  });
}

module.exports = {
  PROHIBITED_EVIDENCE_KEYS,
  sanitizeOutputArtifact,
  createReviewArtifact,
};