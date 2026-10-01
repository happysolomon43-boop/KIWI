'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function edit(relative, transforms) {
  const file = path.join(root, relative);
  let source = fs.readFileSync(file, 'utf8');
  for (const transform of transforms) {
    const count = source.split(transform.before).length - 1;
    if (count !== transform.count) {
      throw new Error(`${relative}: expected ${transform.count} occurrence(s) of ${JSON.stringify(transform.before)}, found ${count}`);
    }
    source = source.split(transform.before).join(transform.after);
  }
  fs.writeFileSync(file, source);
}

edit('services/ai/traffic-controller.js', [
  {
    before: '// Project/model quota failures are deliberately excluded. Delivery A keeps\n  // 429 health route-scoped; global backpressure reacts only to provider or\n  // transport instability that can affect concurrent work across the pool.',
    after: '// Credential-route quota failures are deliberately excluded. Global\n  // backpressure reacts only to provider or transport instability that can\n  // affect concurrent work across the runtime.',
    count: 1,
  },
  {
    before: '      modelId: context.modelId || null,\n      projectSlot: context.projectSlot || null,',
    after: '      routeKey: context.routeKey || null,\n      credentialSlotId: context.credentialSlotId || null,',
    count: 1,
  },
]);

edit('services/ai/execution-contracts.js', [
  {
    before: '    projectSlot: credentialSlot || null,\n    credentialSlot: credentialSlot || null,',
    after: '    credentialSlot: credentialSlot || null,',
    count: 1,
  },
]);

console.log('Neutral runtime contract cleanup completed.');
