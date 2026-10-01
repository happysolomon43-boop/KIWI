'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'services', 'ai', 'orchestrator.js');
let source = fs.readFileSync(file, 'utf8');
const before = 'MODEL_AVAILABILITY_CODES';
const matches = source.split(before).length - 1;
if (matches !== 2) {
  throw new Error(`Expected exactly 2 ${before} references in orchestrator.js, found ${matches}`);
}
source = source.split(before).join('ROUTE_AVAILABILITY_CODES');
if (source.includes(before)) throw new Error('Legacy health constant remains after replacement');
fs.writeFileSync(file, source);
console.log('Updated orchestrator to ROUTE_AVAILABILITY_CODES.');
