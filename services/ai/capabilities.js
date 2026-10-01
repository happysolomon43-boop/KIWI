'use strict';

const AI_CAPABILITIES = Object.freeze({
  INFERENCE: 'INFERENCE',
  REASONING: 'REASONING',
  STRUCTURED_OUTPUT: 'STRUCTURED_OUTPUT',
  LONG_OUTPUT: 'LONG_OUTPUT',
  SPEECH_SYNTHESIS: 'SPEECH_SYNTHESIS',
  IMAGE_GENERATION: 'IMAGE_GENERATION',
  DIAGRAM_RENDER: 'DIAGRAM_RENDER',
});

const AI_INPUT_MODALITIES = Object.freeze({
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
});

const AI_OUTPUT_MODALITIES = Object.freeze({
  TEXT: 'TEXT',
  AUDIO: 'AUDIO',
  IMAGE: 'IMAGE',
  SVG: 'SVG',
});

function normalizeCapability(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(AI_CAPABILITIES).includes(normalized) ? normalized : null;
}

function normalizeInputModality(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(AI_INPUT_MODALITIES).includes(normalized) ? normalized : null;
}

function normalizeOutputModality(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(AI_OUTPUT_MODALITIES).includes(normalized) ? normalized : null;
}

function modelSatisfies({ model, capabilities = [], inputModalities = [], outputModalities = [] } = {}) {
  if (!model) return false;
  const supportedCapabilities = new Set(model.capabilities || []);
  const supportedInputs = new Set(model.inputModalities || []);
  const supportedOutputs = new Set(model.outputModalities || []);
  return capabilities.every((value) => supportedCapabilities.has(value)) &&
    inputModalities.every((value) => supportedInputs.has(value)) &&
    outputModalities.every((value) => supportedOutputs.has(value));
}

module.exports = {
  AI_CAPABILITIES,
  AI_INPUT_MODALITIES,
  AI_OUTPUT_MODALITIES,
  normalizeCapability,
  normalizeInputModality,
  normalizeOutputModality,
  modelSatisfies,
};
