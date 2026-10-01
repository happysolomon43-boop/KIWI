'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function write(relative, content) {
  fs.writeFileSync(path.join(root, relative), content);
}

function replaceExact(source, before, after, expectedCount, label) {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} match(es), found ${count}`);
  }
  return source.split(before).join(after);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

function migrateIndex() {
  let source = read('index.js');

  source = replaceExact(
    source,
    'generationConfig:',
    'generation:',
    6,
    'neutral generation option migration'
  );

  const legacyImagePayload = `  content: {\n    contents: [\n      {\n        parts: [\n          { text: prompt },\n          { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } },\n        ],\n      },\n    ],\n  },`;
  const neutralImagePayload = `  content: [\n    { kind: 'TEXT', text: prompt },\n    {\n      kind: 'IMAGE',\n      mimeType: mimeType || 'image/jpeg',\n      data: base64Image,\n    },\n  ],`;
  source = replaceExact(
    source,
    legacyImagePayload,
    neutralImagePayload,
    1,
    'image import neutral content migration'
  );

  const concurrencyFunction = `function getReckoningGenerationConcurrencyState() {
  const traffic = _aiRuntime.trafficController.snapshot();
  const rawRouteScheduler = _aiRuntime.routeScheduler.snapshot();
  const plan = _aiRuntime.orchestrator.plan('RECKONING_CBT');

  // Only pressure on routes that RECKONING_CBT is actually allowed to use may
  // reduce Reckoning family fan-out. Background/Lite traffic must not make an
  // otherwise healthy Flash Reckoning unnecessarily serialize itself.
  const eligibleCredentialRouteKeys = new Set();
  const eligibleRouteKeys = new Set();
  for (const candidate of plan.candidates || []) {
    const slots = candidate.eligibleCredentialSlots || [];
    if (!slots.length) continue;
    eligibleRouteKeys.add(candidate.routeKey);
    for (const credentialSlotId of slots) {
      eligibleCredentialRouteKeys.add(\`${'${credentialSlotId}'}::${'${candidate.routeKey}'}\`);
    }
  }

  const eligibleCredentialRoutes = (rawRouteScheduler.credentialRoutes || []).filter(
    (route) => eligibleCredentialRouteKeys.has(\`${'${route.credentialSlotId}'}::${'${route.routeKey}'}\`)
  );
  const eligibleRoutes = (rawRouteScheduler.routes || []).filter(
    (route) => eligibleRouteKeys.has(route.routeKey)
  );
  const maxInFlightPerCredentialRoute = Math.max(
    1,
    Number(rawRouteScheduler.maxInFlightPerCredentialRoute) || 1
  );
  const busyRouteCount = eligibleCredentialRoutes.filter(
    (route) => (Number(route.inFlight) || 0) >= maxInFlightPerCredentialRoute
  ).length;
  const pacedRouteCount = eligibleRoutes.filter(
    (route) => (Number(route.waitMs) || 0) > 0
  ).length;

  const routeScheduler = Object.freeze({
    ...rawRouteScheduler,
    credentialRoutes: Object.freeze(eligibleCredentialRoutes),
    routes: Object.freeze(eligibleRoutes),
    eligibleCredentialRouteCount: eligibleCredentialRouteKeys.size,
    eligibleRouteCount: eligibleRouteKeys.size,
  });

  return Object.freeze({
    ...traffic,
    routeScheduler,
    busyRouteCount,
    pacedRouteCount,
    eligibleCredentialRouteCount: eligibleCredentialRouteKeys.size,
    eligibleRouteCount: eligibleRouteKeys.size,
  });
}`;

  source = replaceRegexOnce(
    source,
    /function getReckoningGenerationConcurrencyState\(\) \{[\s\S]*?\n\}\n\nconst adaptivePreparationService = createPreparationService/,
    `${concurrencyFunction}\n\nconst adaptivePreparationService = createPreparationService`,
    'Reckoning route concurrency migration'
  );

  source = replaceExact(
    source,
    '// orchestrator as the rest of KIWI. Gemini writes questions; KIWI owns the plan,',
    '// orchestrator as the rest of KIWI. The selected AI route writes questions; KIWI owns the plan,',
    1,
    'Reckoning provider-neutral comment migration'
  );

  if (/\binlineData\b/.test(source)) throw new Error('index.js still contains inlineData after migration');
  if (/\beligibleProjectSlots\b/.test(source)) throw new Error('index.js still contains eligibleProjectSlots after migration');
  if (/\bgenerationConfig\s*:/.test(source)) throw new Error('index.js still passes generationConfig to AI runtime');

  write('index.js', source);
}

function migrateReckoningPreparation() {
  let source = read('services/reckoning/preparation.js');

  const neutralResolver = `function resolveFamilyConcurrency(snapshot, config) {
  const maxConcurrency = Math.max(
    1,
    Number(config?.preparation?.familyConcurrency) || 1
  );
  if (!snapshot || typeof snapshot !== 'object') return maxConcurrency;

  const level = String(snapshot.congestionLevel || 'NORMAL').toUpperCase();
  if (level === 'SEVERE') {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.severeFamilyConcurrency) || 1)
    );
  }
  if (level === 'HIGH') {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.highFamilyConcurrency) || 1)
    );
  }
  if (level === 'ELEVATED') {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.elevatedFamilyConcurrency) || 2)
    );
  }

  const routeScheduler = snapshot.routeScheduler || {};
  const routes = Array.isArray(routeScheduler.routes)
    ? routeScheduler.routes
    : [];
  const credentialRoutes = Array.isArray(routeScheduler.credentialRoutes)
    ? routeScheduler.credentialRoutes
    : [];
  const pacedRouteCount = Math.max(
    0,
    Number(snapshot.pacedRouteCount) ||
      routes.filter((route) => (Number(route.waitMs) || 0) > 0).length
  );
  const maxCredentialRouteInFlight = Math.max(
    1,
    Number(routeScheduler.maxInFlightPerCredentialRoute) || 1
  );
  const busyRouteCount = Math.max(
    0,
    Number(snapshot.busyRouteCount) ||
      credentialRoutes.filter(
        (route) => (Number(route.inFlight) || 0) >= maxCredentialRouteInFlight
      ).length
  );
  const eligibleCredentialRouteCount = Math.max(
    credentialRoutes.length,
    Number(snapshot.eligibleCredentialRouteCount) ||
      Number(routeScheduler.eligibleCredentialRouteCount) ||
      0
  );
  const routeBusyRatio = eligibleCredentialRouteCount > 0
    ? busyRouteCount / eligibleCredentialRouteCount
    : 0;
  const criticalQueued = Math.max(
    0,
    Number(snapshot.queuedByLane?.CRITICAL) || 0
  );

  if (pacedRouteCount > 0 || routeBusyRatio >= 0.75 || criticalQueued > 0) {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.severeFamilyConcurrency) || 1)
    );
  }
  if (routeBusyRatio >= 0.5) {
    return Math.min(
      maxConcurrency,
      Math.max(1, Number(config?.preparation?.elevatedFamilyConcurrency) || 2)
    );
  }
  if ((Number(snapshot.queued) || 0) > 0) return 1;

  const effective = Math.max(
    1,
    Number(snapshot.effectiveConcurrency) || maxConcurrency
  );
  const active = Math.max(0, Number(snapshot.active) || 0);
  const immediatelyAvailable = Math.max(1, effective - active);
  return Math.max(1, Math.min(maxConcurrency, immediatelyAvailable));
}`;

  source = replaceRegexOnce(
    source,
    /function resolveFamilyConcurrency\(snapshot, config\) \{[\s\S]*?\n\}\n\nasync function mapWithAdaptiveConcurrency/,
    `${neutralResolver}\n\nasync function mapWithAdaptiveConcurrency`,
    'Reckoning preparation neutral scheduler migration'
  );

  if (/\brouteScheduler\.models\b|\bpacedModelCount\b|\bmaxInFlightPerRoute\b/.test(source)) {
    throw new Error('services/reckoning/preparation.js still contains legacy model-route scheduler vocabulary');
  }

  write('services/reckoning/preparation.js', source);
}

migrateIndex();
migrateReckoningPreparation();
console.log('Neutral AI caller migration completed with all invariants satisfied.');
