'use strict';

const fs = require('fs');
const path = require('path');
const { syncPixiVendor, PIXI_VERSION } = require('./sync-pixi-vendor');

function copyDirectoryContents(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(source, target, { recursive: true });
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

function buildWeb(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const distDir = path.join(rootDir, options.distDir || 'dist');
  const publicDir = path.join(rootDir, 'public');
  const indexFile = path.join(rootDir, 'index.html');

  if (!fs.existsSync(indexFile)) {
    throw new Error(`Missing frontend entry point: ${indexFile}`);
  }

  syncPixiVendor({ rootDir });

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  fs.copyFileSync(indexFile, path.join(distDir, 'index.html'));
  copyDirectoryContents(publicDir, distDir);

  const runtimeFile = path.join(distDir, 'vendor', 'pixi', 'pixi.min.mjs');
  if (!fs.existsSync(runtimeFile)) {
    throw new Error('PixiJS vendor bundle was not copied into the web build.');
  }

  fs.writeFileSync(
    path.join(distDir, 'kiwi-build.json'),
    JSON.stringify(
      {
        frontend: 'KIWI',
        pixi: PIXI_VERSION,
        generatedBy: 'scripts/build-web.js',
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  return { distDir, pixiVersion: PIXI_VERSION };
}

if (require.main === module) {
  try {
    const result = buildWeb();
    console.log(
      `[KIWI] Web build ready at ${path.relative(process.cwd(), result.distDir)} (PixiJS ${result.pixiVersion})`
    );
  } catch (error) {
    console.error('[KIWI] Web build failed:', error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  copyDirectoryContents,
  buildWeb,
};
