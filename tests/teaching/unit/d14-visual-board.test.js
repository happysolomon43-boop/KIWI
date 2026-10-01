'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_CAPABILITIES } = require('../../../services/ai/capabilities');
const { createModelCatalog } = require('../../../services/ai/model-catalog');
const {
  AI_VISUAL_CAPABILITIES,
  VISUAL_AUTHORITY,
  createImageGenerationRequest,
  createGeneratedImageResponse,
  createDiagramRenderRequest,
  createDiagramRenderResponse,
  imageGenerationCacheKey,
  diagramCacheKey,
} = require('../../../services/ai/visual-contracts');
const {
  createGenerativeImageBoardBlock,
  createStructuredDiagramBoardBlock,
  createVisualBoardFallback,
} = require('../../../teaching/d14/visual-board-contract');

const IMAGE_GENERATION_ROUTE = createModelCatalog()
  .firstApprovedCapability(AI_CAPABILITIES.IMAGE_GENERATION);

function jpegBase64() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x02, 0x00, 0x03, 0x00,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]).toString('base64');
}

test('D05 Board generative image contract remains explicitly illustrative and local-asset-only', () => {
  assert.ok(IMAGE_GENERATION_ROUTE);
  assert.ok(IMAGE_GENERATION_ROUTE.capabilities.includes(AI_CAPABILITIES.IMAGE_GENERATION));

  const request = createImageGenerationRequest({
    prompt: 'Illustrate the phospholipid bilayer without labels',
    altText: 'Illustration of a phospholipid bilayer',
    seed: 3,
  });
  const visual = createGeneratedImageResponse({
    request,
    provider: IMAGE_GENERATION_ROUTE.provider,
    modelId: IMAGE_GENERATION_ROUTE.id,
    data: jpegBase64(),
    cacheKey: imageGenerationCacheKey(request, IMAGE_GENERATION_ROUTE.id),
  });
  const block = createGenerativeImageBoardBlock({
    visual,
    asset: { assetId: 'asset-illustration-1', src: '/teaching/assets/illustration-1.jpg' },
  });

  assert.equal(block.type, 'image');
  assert.equal(block.content.visualAuthority, VISUAL_AUTHORITY.ILLUSTRATIVE);
  assert.equal(block.content.academicAuthority, 'SUPPLEMENTARY_ONLY');
  assert.equal(block.content.provenance.capability, AI_VISUAL_CAPABILITIES.IMAGE_GENERATION);
  assert.equal(block.content.provenance.generated, true);
  assert.equal(block.content.provenance.deterministic, false);
  assert.equal(block.content.src.startsWith('/'), true);

  assert.throws(
    () => createGenerativeImageBoardBlock({
      visual,
      asset: { assetId: 'bad', src: 'https://provider.example/image.jpg' },
    }),
    (error) => error.code === 'TEACHING_D14_VISUAL_CONTRACT_INVALID'
  );
});

test('D05 Board structured diagram contract preserves exact/deterministic/sanitized provenance', () => {
  const request = createDiagramRenderRequest({
    diagramType: 'graphviz',
    source: 'digraph G { monosaccharide -> disaccharide }',
    altText: 'Monosaccharide to disaccharide relationship',
    fallbackText: 'A monosaccharide leads to a disaccharide in this diagram.',
  });
  const visual = createDiagramRenderResponse({
    request,
    provider: 'KROKI',
    rendererId: 'KROKI',
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>mono to di</text></svg>',
    cacheKey: diagramCacheKey(request),
  });
  const block = createStructuredDiagramBoardBlock({
    visual,
    asset: { assetId: 'asset-diagram-1', src: '/teaching/assets/diagram-1.svg' },
  });

  assert.equal(block.type, 'diagram');
  assert.equal(block.content.visualAuthority, VISUAL_AUTHORITY.STRUCTURED_EXACT);
  assert.equal(block.content.academicAuthority, 'STRUCTURED_VISUAL');
  assert.equal(block.content.provenance.capability, AI_VISUAL_CAPABILITIES.DIAGRAM_RENDER);
  assert.equal(block.content.provenance.deterministic, true);
  assert.equal(block.content.provenance.sanitized, true);
  assert.equal(block.content.provenance.diagramType, 'graphviz');
  assert.equal(block.content.provenance.sourceHash, request.sourceHash);
  assert.equal(Object.prototype.hasOwnProperty.call(block.content.provenance, 'source'), false);
});

test('D05 Board refuses degraded diagram as visual but preserves a normal text fallback', () => {
  const request = createDiagramRenderRequest({
    diagramType: 'graphviz',
    source: 'digraph G { A -> B }',
    fallbackText: 'A points to B.',
  });
  const degraded = createDiagramRenderResponse({
    request,
    provider: 'KROKI',
    rendererId: 'KROKI',
    cacheKey: diagramCacheKey(request),
    degraded: true,
    failure: { code: 'TIMEOUT', retryable: true },
  });

  assert.throws(
    () => createStructuredDiagramBoardBlock({
      visual: degraded,
      asset: { assetId: 'none', src: '/teaching/assets/none.svg' },
    }),
    (error) => error.code === 'TEACHING_D14_VISUAL_CONTRACT_INVALID'
  );

  const fallback = createVisualBoardFallback({ visual: degraded });
  assert.equal(fallback.type, 'text');
  assert.equal(fallback.content.text, 'A points to B.');
});
