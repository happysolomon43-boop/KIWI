'use strict';

// Compatibility preload retained so an existing NODE_OPTIONS reference cannot
// break process startup. D03 provider-specific routing is retired; the neutral
// runtime now owns route qualification and selection.
if (String(process.env.AI_D03_SMOKE_ON_START || '').toLowerCase() === 'true') {
  console.warn('[KIWI AI] legacy D03 preload requested; neutral runtime validation is active');
}
