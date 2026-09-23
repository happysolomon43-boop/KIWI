'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PIXI_VERSION,
  syncPixiVendor,
} = require('../../scripts/sync-pixi-vendor');
const {
  buildWeb,
} = require('../../scripts/build-web');

const ROOT = path.join(__dirname, '../..');

async function importModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href + '?t=' + Date.now());
}

test('PixiJS dependency is pinned exactly rather than floating', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.equal(pkg.dependencies['pixi.js'], '8.21.0');
  assert.equal(PIXI_VERSION, '8.21.0');
  assert.equal(pkg.scripts.postinstall, 'node scripts/sync-pixi-vendor.js');
  assert.equal(pkg.scripts.build, 'node scripts/build-web.js');
});

test('runtime policy scales resolution and FPS down on constrained mobile devices', async () => {
  const {
    derivePixiRuntimePolicy,
    classifyViewport,
  } = await importModule('public/tree/runtime-policy.mjs');

  assert.equal(classifyViewport(390), 'mobile');
  assert.equal(classifyViewport(900), 'tablet');
  assert.equal(classifyViewport(1440), 'desktop');

  const mobile = derivePixiRuntimePolicy({
    viewportWidth: 390,
    devicePixelRatio: 3,
    deviceMemory: 4,
    hardwareConcurrency: 4,
  });

  assert.equal(mobile.profile, 'mobile');
  assert.equal(mobile.constrainedDevice, true);
  assert.equal(mobile.resolution, 1.25);
  assert.equal(mobile.maxFPS, 30);
  assert.equal(mobile.antialias, false);
  assert.equal(mobile.powerPreference, 'low-power');

  const desktop = derivePixiRuntimePolicy({
    viewportWidth: 1440,
    devicePixelRatio: 3,
    deviceMemory: 16,
    hardwareConcurrency: 12,
  });

  assert.equal(desktop.profile, 'desktop');
  assert.equal(desktop.constrainedDevice, false);
  assert.equal(desktop.resolution, 2);
  assert.equal(desktop.maxFPS, 60);
  assert.equal(desktop.antialias, true);
});

test('save-data and reduced-motion signals are honored by runtime policy', async () => {
  const {
    derivePixiRuntimePolicy,
  } = await importModule('public/tree/runtime-policy.mjs');

  const policy = derivePixiRuntimePolicy({
    viewportWidth: 1440,
    devicePixelRatio: 2,
    deviceMemory: 16,
    hardwareConcurrency: 12,
    saveData: true,
    reducedMotion: true,
  });

  assert.equal(policy.saveData, true);
  assert.equal(policy.reducedMotion, true);
  assert.equal(policy.motionScale, 0);
  assert.equal(policy.resolution, 1);
  assert.equal(policy.maxFPS, 30);
  assert.equal(policy.powerPreference, 'low-power');
});

test('ticker pauses when hidden, offscreen, or destroyed', async () => {
  const {
    shouldRunTicker,
  } = await importModule('public/tree/runtime-policy.mjs');

  assert.equal(shouldRunTicker({}), true);
  assert.equal(shouldRunTicker({ documentHidden: true }), false);
  assert.equal(
    shouldRunTicker({ intersectionKnown: true, intersecting: false }),
    false
  );
  assert.equal(shouldRunTicker({ destroyed: true }), false);
});

test('renderer gateway defaults to legacy and rejects unknown modes safely', async () => {
  const {
    getDefaultTreeRendererMode,
    normalizeTreeRendererMode,
  } = await importModule('public/tree/tree-renderer-gateway.mjs');

  assert.equal(getDefaultTreeRendererMode(), 'legacy');
  assert.equal(normalizeTreeRendererMode('legacy'), 'legacy');
  assert.equal(normalizeTreeRendererMode('PIXI'), 'pixi');
  assert.equal(normalizeTreeRendererMode('future-renderer'), 'legacy');
  assert.equal(normalizeTreeRendererMode(null), 'legacy');
});

test('legacy gateway can mount without loading PixiJS', async () => {
  const {
    mountKiwiTreeRenderer,
  } = await importModule('public/tree/tree-renderer-gateway.mjs');

  const children = [];
  const container = {
    get firstChild() {
      return children[0] || null;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
    },
  };

  let calls = 0;
  const result = await mountKiwiTreeRenderer({
    container,
    mode: 'legacy',
    state: { stage: 5 },
    legacyFactory(target, options) {
      calls += 1;
      assert.equal(target, container);
      assert.equal(options.state.stage, 5);
      return { type: 'legacy-test' };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.mode, 'legacy');
  assert.equal(result.fallbackReason, null);
  assert.equal(result.instance.type, 'legacy-test');
});

test('vendor sync copies a pinned local Pixi browser module and license', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-pixi-sync-'));

  try {
    const sourceDir = path.join(temp, 'node_modules', 'pixi.js', 'dist');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'pixi.min.mjs'), 'export const PIXI_TEST = true;\n');
    fs.writeFileSync(path.join(temp, 'node_modules', 'pixi.js', 'LICENSE'), 'MIT TEST LICENSE\n');

    const result = syncPixiVendor({ rootDir: temp });

    assert.equal(
      fs.readFileSync(result.targetFile, 'utf8'),
      'export const PIXI_TEST = true;\n'
    );
    assert.equal(
      fs.readFileSync(path.join(result.vendorDir, 'LICENSE'), 'utf8'),
      'MIT TEST LICENSE\n'
    );

    const version = JSON.parse(
      fs.readFileSync(path.join(result.vendorDir, 'version.json'), 'utf8')
    );
    assert.equal(version.version, '8.21.0');
    assert.equal(version.runtimePath, '/vendor/pixi/pixi.min.mjs');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('web build preserves root assets and includes the local Pixi runtime', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-web-build-'));

  try {
    fs.mkdirSync(path.join(temp, 'public', 'tree'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'node_modules', 'pixi.js', 'dist'), { recursive: true });

    fs.writeFileSync(path.join(temp, 'index.html'), '<!doctype html><title>KIWI</title>');
    fs.writeFileSync(path.join(temp, 'public', 'kiwi.css'), 'body{}');
    fs.writeFileSync(path.join(temp, 'public', 'tree', 'runtime-policy.mjs'), 'export {};');
    fs.writeFileSync(
      path.join(temp, 'node_modules', 'pixi.js', 'dist', 'pixi.min.mjs'),
      'export const Application = class {};\n'
    );

    const result = buildWeb({ rootDir: temp });

    assert.equal(fs.existsSync(path.join(result.distDir, 'index.html')), true);
    assert.equal(fs.existsSync(path.join(result.distDir, 'kiwi.css')), true);
    assert.equal(
      fs.existsSync(path.join(result.distDir, 'tree', 'runtime-policy.mjs')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(result.distDir, 'vendor', 'pixi', 'pixi.min.mjs')),
      true
    );

    const metadata = JSON.parse(
      fs.readFileSync(path.join(result.distDir, 'kiwi-build.json'), 'utf8')
    );
    assert.equal(metadata.pixi, '8.21.0');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Vercel uses the modern build command and dist output with filesystem precedence', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

  assert.equal(config.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.equal(config.buildCommand, 'npm run build:web');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(Object.hasOwn(config, 'builds'), false);
  assert.deepEqual(config.routes[0], { handle: 'filesystem' });
  assert.deepEqual(config.routes[1], { src: '/(.*)', dest: '/index.html' });
});

test('Pixi runtime imports only the locally vendored browser module', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'public/tree/pixi-runtime.mjs'),
    'utf8'
  );

  assert.match(source, /from '\/vendor\/pixi\/pixi\.min\.mjs'/);
  assert.doesNotMatch(source, /cdn\.jsdelivr|unpkg|cdnjs|https:\/\//);
  assert.match(source, /resizeTo: this\.container/);
  assert.match(source, /sharedTicker: false/);
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /pointerEvents: 'none'/);
});
