'use strict';

// Compatibility preload retained so an existing NODE_OPTIONS reference cannot
// break process startup. Provider-specific smoke routing is retired; provider
// adapters are validated through the model-neutral runtime.
if (String(process.env.AI_GROQ_SMOKE_ON_START || '').toLowerCase() === 'true') {
  console.warn('[KIWI AI] legacy provider preload requested; neutral runtime validation is active');
}
