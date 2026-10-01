'use strict';

const { AI_PROVIDERS } = require('./providers');
const {
  AI_VISUAL_CAPABILITIES,
  SUPPORTED_DIAGRAM_TYPES,
  DEFAULT_IMAGE_GENERATION_STEPS,
  MAX_IMAGE_GENERATION_STEPS,
} = require('./visual-contracts');

const VISUAL_MODEL_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  CONFIG_REQUIRED: 'CONFIG_REQUIRED',
});

const CLOUDFLARE_IMAGE_MODELS = Object.freeze({
  FLUX_2_DEV: '@cf/black-forest-labs/flux-2-dev',
});

const IMAGE_GENERATION_ROUTE = Object.freeze({
  capability: AI_VISUAL_CAPABILITIES.IMAGE_GENERATION,
  provider: AI_PROVIDERS.CLOUDFLARE,
  modelId: CLOUDFLARE_IMAGE_MODELS.FLUX_2_DEV,
  role: 'PRIMARY',
  status: VISUAL_MODEL_STATUS.AVAILABLE,
  maxPromptCharacters: 2048,
  defaultSteps: DEFAULT_IMAGE_GENERATION_STEPS,
  maxSteps: MAX_IMAGE_GENERATION_STEPS,
  requestEncoding: 'multipart/form-data',
  responseFormats: Object.freeze(['image/jpeg', 'image/png']),
  metadata: Object.freeze({
    delivery: 'AIM_D05',
    generation: 'FLUX_2',
    variant: 'DEV',
    illustrativeOnly: true,
    isolatedFromTextRouting: true,
  }),
});

const KROKI_RENDER_ROUTE = Object.freeze({
  capability: AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER,
  provider: AI_PROVIDERS.KROKI,
  rendererId: 'KROKI',
  role: 'PRIMARY',
  status: VISUAL_MODEL_STATUS.CONFIG_REQUIRED,
  outputFormat: 'svg',
  supportedDiagramTypes: SUPPORTED_DIAGRAM_TYPES,
  metadata: Object.freeze({
    delivery: 'AIM_D05',
    deterministic: true,
    isolatedFromTextRouting: true,
  }),
});

module.exports = {
  VISUAL_MODEL_STATUS,
  CLOUDFLARE_IMAGE_MODELS,
  IMAGE_GENERATION_ROUTE,
  KROKI_RENDER_ROUTE,
};
