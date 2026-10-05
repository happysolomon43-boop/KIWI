'use strict';

const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.js');
let source = fs.readFileSync(indexPath, 'utf8');

function count(text, needle) {
  return text.split(needle).length - 1;
}

function replaceExactlyOnce(needle, replacement, label) {
  const occurrences = count(source, needle);
  if (occurrences !== 1) {
    throw new Error(`[D31] Expected exactly one ${label} anchor, found ${occurrences}. Refusing to rewrite index.js.`);
  }
  source = source.replace(needle, replacement);
}

const d31Import = "const { createD31ReleaseIntelligence } = require('./teaching/d31');";
if (!source.includes(d31Import)) {
  const importAnchor = "const { createTeachingD05RuntimePlatform } = require('./teaching/runtime');";
  replaceExactlyOnce(
    importAnchor,
    `${importAnchor}\n${d31Import}`,
    'Teaching runtime import'
  );
}

const platformAnchor = `const teachingRuntimePlatform = createTeachingD05RuntimePlatform({
  query,
  withTransaction,
  randomUUID,
  aiRun: teachingAIRun,
  eventPublisher: (event) => teachingPublishedEvents.publish(event),
  env: process.env,
  logger: console,
});`;

const releaseComposition = `${platformAnchor}
const teachingD31Release = createD31ReleaseIntelligence({
  runtimePlatform: teachingRuntimePlatform,
  env: process.env,
});
console.info(
  '[KIWI Teaching D31] AI release authorization:',
  teachingD31Release.authorization.releaseAuthorization,
  'qualification:',
  teachingD31Release.authorization.qualificationDisposition
);`;

if (!source.includes('const teachingD31Release = createD31ReleaseIntelligence({')) {
  replaceExactlyOnce(platformAnchor, releaseComposition, 'Teaching D05 runtime composition');
}

const heldBlock = `  // D30 has not qualified Teaching model routes. D07/D08 intelligence remains
  // wired through Teaching-Orchestrator contracts and therefore held.
  d07Intelligence: null,
  d08Intelligence: null,
  d09Intelligence: null,
  d11Intelligence: null,
  d11PublishedEventRegistry: teachingPublishedEvents,
  d12Intelligence: null,
  d12PublishedEventRegistry: teachingPublishedEvents,
  // D30 has not empirically qualified TPF-09/TPF-19 Teaching routes. D13
  // deterministic SKM state is active; optional model interpretation is held.
  d13Intelligence: null,
  d13PublishedEventRegistry: teachingPublishedEvents,`;

const releaseBlock = `  // D31 release composition remains fail-closed unless the exact owner-authorized
  // server mode is active. Activation does not alter D30 empirical qualification.
  ...teachingD31Release.intelligence,
  d11PublishedEventRegistry: teachingPublishedEvents,
  d12PublishedEventRegistry: teachingPublishedEvents,
  d13PublishedEventRegistry: teachingPublishedEvents,`;

if (!source.includes('...teachingD31Release.intelligence,')) {
  replaceExactlyOnce(heldBlock, releaseBlock, 'D30 Teaching AI hold block');
}

const requiredMarkers = [
  d31Import,
  'const teachingD31Release = createD31ReleaseIntelligence({',
  '...teachingD31Release.intelligence,',
  'd16Intelligence',
  'd17Intelligence',
];
for (const marker of requiredMarkers) {
  if (!source.includes(marker)) throw new Error(`[D31] Required release-wiring marker missing: ${marker}`);
}

if (source.includes('d07Intelligence: null') || source.includes('d13Intelligence: null')) {
  throw new Error('[D31] Legacy explicit Teaching AI hold values remain after release wiring.');
}

fs.writeFileSync(indexPath, source, 'utf8');
console.log('[D31] Applied guarded owner-release composition to index.js.');
