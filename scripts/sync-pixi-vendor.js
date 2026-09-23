'use strict';

const fs = require('fs');
const path = require('path');

const PIXI_VERSION = '8.21.0';
const PIXI_SOURCE_RELATIVE = path.join('node_modules', 'pixi.js', 'dist', 'pixi.min.mjs');
const PIXI_LICENSE_RELATIVE = path.join('node_modules', 'pixi.js', 'LICENSE');
const PIXI_VENDOR_RELATIVE = path.join('public', 'vendor', 'pixi');

function syncPixiVendor(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const sourceFile = path.join(rootDir, PIXI_SOURCE_RELATIVE);
  const licenseFile = path.join(rootDir, PIXI_LICENSE_RELATIVE);
  const vendorDir = path.join(rootDir, PIXI_VENDOR_RELATIVE);
  const targetFile = path.join(vendorDir, 'pixi.min.mjs');
  const versionFile = path.join(vendorDir, 'version.json');

  if (!fs.existsSync(sourceFile)) {
    throw new Error(
      `PixiJS ${PIXI_VERSION} browser bundle is missing at ${sourceFile}. Run npm install first.`
    );
  }

  fs.mkdirSync(vendorDir, { recursive: true });
  fs.copyFileSync(sourceFile, targetFile);

  if (fs.existsSync(licenseFile)) {
    fs.copyFileSync(licenseFile, path.join(vendorDir, 'LICENSE'));
  }

  fs.writeFileSync(
    versionFile,
    JSON.stringify(
      {
        package: 'pixi.js',
        version: PIXI_VERSION,
        source: 'npm',
        runtimePath: '/vendor/pixi/pixi.min.mjs',
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  return {
    version: PIXI_VERSION,
    sourceFile,
    targetFile,
    vendorDir,
  };
}

if (require.main === module) {
  try {
    const result = syncPixiVendor();
    console.log(
      `[KIWI] PixiJS ${result.version} vendored to ${path.relative(process.cwd(), result.targetFile)}`
    );
  } catch (error) {
    console.error('[KIWI] Failed to vendor PixiJS:', error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  PIXI_VERSION,
  PIXI_SOURCE_RELATIVE,
  PIXI_VENDOR_RELATIVE,
  syncPixiVendor,
};
