'use strict';

const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.join(__dirname, '..', 'index.js');
let source = fs.readFileSync(indexPath, 'utf8');

function requireSingleIndex(marker, label) {
  const first = source.indexOf(marker);
  const last = source.lastIndexOf(marker);
  if (first < 0 || first !== last) {
    throw new Error(`[D31 recovery] Expected exactly one ${label} marker. Refusing to rewrite index.js.`);
  }
  return first;
}

const importLine = "const { createStudyImportRouter } = require('./study-import');";
if (!source.includes(importLine)) {
  const teachingImport = "const { createTeachingRouter } = require('./teaching-backend');";
  const importAt = requireSingleIndex(teachingImport, 'Teaching router import');
  const insertionAt = importAt + teachingImport.length;
  source = `${source.slice(0, insertionAt)}\n${importLine}${source.slice(insertionAt)}`;
}

const parserMarker = '// ── Additional requires for file parsing';
if (source.includes(parserMarker)) {
  const parserStart = requireSingleIndex(parserMarker, 'legacy file-parser block');
  const limiterMarker = '// ── AI Rate Limiter';
  const limiterStart = source.indexOf(limiterMarker, parserStart);
  if (limiterStart < 0) throw new Error('[D31 recovery] AI rate-limiter marker is missing after legacy parser block.');
  source = `${source.slice(0, parserStart)}${source.slice(limiterStart)}`;
}

const routeStartMarker = '// Import routes with SEEDLING adaptation';
const mountMarker = "cardRouter.use('/import', createStudyImportRouter";
if (!source.includes(mountMarker)) {
  const routeStart = requireSingleIndex(routeStartMarker, 'legacy import-route block');
  const studyMarker = '//  STUDY ROUTES';
  const studyAt = source.indexOf(studyMarker, routeStart);
  if (studyAt < 0) throw new Error('[D31 recovery] STUDY ROUTES marker is missing after legacy import routes.');
  const separatorAt = source.lastIndexOf('// ═', studyAt);
  if (separatorAt < routeStart) throw new Error('[D31 recovery] STUDY ROUTES separator is missing after legacy import routes.');

  const mount = `cardRouter.use('/import', createStudyImportRouter({
  express,
  db,
  generateFlashcards,
  parseFlashcards,
  extractFromImage,
  generateCBTQuestions,
  parseCBTResponse,
  estimateCBTCount,
  batchInitializeSeedlingStates,
  persistKnowledgeScore,
  checkAIRateLimit,
  jobStoreSet: _jobStoreSet,
  wsSend,
}));\n\n`;
  source = `${source.slice(0, routeStart)}${mount}${source.slice(separatorAt)}`;
}

const forbidden = [
  "cardRouter.post('/import/",
  'pdfParse',
  'mammoth',
  'officeparser',
];
for (const marker of forbidden) {
  if (source.includes(marker)) throw new Error(`[D31 recovery] Legacy study-import marker remains in index.js: ${marker}`);
}
if (!source.includes(importLine) || !source.includes(mountMarker)) {
  throw new Error('[D31 recovery] Study import extraction is incomplete.');
}

fs.writeFileSync(indexPath, source, 'utf8');
console.log('[D31 recovery] Reconciled the intended post-D30 Study import module extraction.');
