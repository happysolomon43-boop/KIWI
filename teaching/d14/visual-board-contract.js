'use strict';

const { validateBlock } = require('./board');
const { AI_VISUAL_CAPABILITIES, VISUAL_AUTHORITY } = require('../../services/ai/visual-contracts');

function invalid(message) {
  throw Object.assign(new Error(message), {
    code: 'TEACHING_D14_VISUAL_CONTRACT_INVALID',
    status: 422,
  });
}

function assetRef(value) {
  if (!value || typeof value !== 'object') invalid('Board visual requires a materialized KIWI asset reference.');
  const assetId = String(value.assetId || '').trim();
  const src = String(value.src || '').trim();
  if (!assetId || !/^\/(?!\/)[a-zA-Z0-9/_ .%-]+$/.test(src)) {
    invalid('Board visual asset must use a local KIWI asset path.');
  }
  return { assetId, src };
}

function safeProvenance(base) {
  return Object.freeze({
    capability: base.capability,
    provider: base.provider || null,
    modelId: base.modelId || null,
    rendererId: base.rendererId || null,
    diagramType: base.diagramType || null,
    cacheKey: base.cacheKey || null,
    sourceHash: base.sourceHash || null,
    authority: base.authority,
    generated: Boolean(base.generated),
    deterministic: Boolean(base.deterministic),
    sanitized: Boolean(base.sanitized),
  });
}

function createGenerativeImageBoardBlock({ visual, asset } = {}) {
  if (
    !visual ||
    visual.capability !== AI_VISUAL_CAPABILITIES.IMAGE_GENERATION ||
    visual.authority !== VISUAL_AUTHORITY.ILLUSTRATIVE
  ) invalid('Board image contract requires a validated illustrative image response.');
  const materialized = assetRef(asset);
  return validateBlock({
    type: 'image',
    content: {
      src: materialized.src,
      assetId: materialized.assetId,
      alt: visual.altText,
      visualAuthority: VISUAL_AUTHORITY.ILLUSTRATIVE,
      academicAuthority: 'SUPPLEMENTARY_ONLY',
      provenance: safeProvenance({
        capability: visual.capability,
        provider: visual.provider,
        modelId: visual.modelId,
        cacheKey: visual.cacheKey,
        authority: visual.authority,
        generated: true,
        deterministic: false,
        sanitized: false,
      }),
      fallback: Object.freeze({ type: 'text', text: visual.altText }),
    },
  });
}

function createStructuredDiagramBoardBlock({ visual, asset } = {}) {
  if (
    !visual ||
    visual.capability !== AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER ||
    visual.authority !== VISUAL_AUTHORITY.STRUCTURED_EXACT ||
    visual.degraded ||
    !visual.output?.svg
  ) invalid('Board diagram contract requires a successful sanitized structured diagram response.');
  const materialized = assetRef(asset);
  return validateBlock({
    type: 'diagram',
    content: {
      src: materialized.src,
      assetId: materialized.assetId,
      alt: visual.altText,
      visualAuthority: VISUAL_AUTHORITY.STRUCTURED_EXACT,
      academicAuthority: 'STRUCTURED_VISUAL',
      provenance: safeProvenance({
        capability: visual.capability,
        provider: visual.provider,
        rendererId: visual.rendererId,
        diagramType: visual.diagramType,
        cacheKey: visual.cacheKey,
        sourceHash: visual.sourceHash,
        authority: visual.authority,
        generated: false,
        deterministic: true,
        sanitized: Boolean(visual.provenance?.sanitized),
      }),
      fallback: visual.fallback,
    },
  });
}

function createVisualBoardFallback({ visual, text = null } = {}) {
  const fallback = String(text || visual?.fallback?.text || visual?.altText || 'Visual unavailable.').trim();
  if (!fallback) invalid('Board visual fallback requires text.');
  return validateBlock({ type: 'text', content: { text: fallback.slice(0, 5000) } });
}

module.exports = {
  createGenerativeImageBoardBlock,
  createStructuredDiagramBoardBlock,
  createVisualBoardFallback,
};
