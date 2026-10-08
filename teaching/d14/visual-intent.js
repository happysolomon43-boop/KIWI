'use strict';
const {createImageGenerationRequest,createDiagramRenderRequest}=require('../../services/ai/visual-contracts');

// A Teacher declares instructional intent, never URLs, asset IDs or providers.
// One bounded representation per turn keeps generation within the worker budget.
function normalizeVisualIntent(value) {
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid Teacher visual intent.');
  const allowed=value.kind==='IMAGE'?['kind','prompt','altText']:['kind','diagramType','source','altText','fallbackText'];
  if(Object.keys(value).some(k=>!allowed.includes(k)))throw new TypeError('Unsupported visual intent field.');
  if(typeof value.altText!=='string'||!value.altText.trim())throw new TypeError('A visual requires an accessible explanation.');
  if(value.kind==='IMAGE') {
    const request=createImageGenerationRequest(value);
    return Object.freeze({kind:'IMAGE',prompt:request.prompt,altText:request.altText});
  }
  if(value.kind==='DIAGRAM') {
    // The general renderer accepts larger specifications; live instruction has
    // a deliberately smaller input and time budget.
    if(typeof value.source!=='string'||value.source.length>6000)throw new TypeError('Classroom diagram source is too large.');
    const request=createDiagramRenderRequest(value);
    return Object.freeze({kind:'DIAGRAM',diagramType:request.diagramType,source:request.source,altText:request.altText,fallbackText:request.fallbackText});
  }
  throw new TypeError('Unsupported Teacher visual kind.');
}
const VISUAL_INSTRUCTION='You may return visualRequest=null or one instructional visual. DIAGRAM: {kind:"DIAGRAM",diagramType:"graphviz" (or another listed supported language),source:"complete renderer source",altText:"accessible description",fallbackText:"plain-language explanation"}. IMAGE: {kind:"IMAGE",prompt:"illustration prompt",altText:"accessible description"}. Use diagrams for exact relationships, processes, labels or numeric information; images are supplementary illustrations and must not convey exact equations, measurements or assessed answers. Request only configured capabilities, grounded in the supplied lesson. Do not choose providers, URLs or asset IDs. Earlier published Board representations are generation/publication acknowledgements. Reuse their explanation when suitable, and acknowledge an unavailable visual honestly. Never claim a newly requested visual has been generated: generation and publication occur after your validated proposal. Explain the concept in teacherMessage even if the visual fails.';
module.exports={normalizeVisualIntent,VISUAL_INSTRUCTION};
