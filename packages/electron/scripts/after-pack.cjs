const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { verifyPackagedAppContents, copyTypescriptPlatformLibs } = require('./packaged-app-contents.cjs');

// Resolve the vendored TypeScript install exactly the way the packaged
// engine will at runtime: anchored at the consumer whose bundle inlines
// the compiler API, so build-time and runtime resolution cannot drift.
const resolveTypescriptDir = () => {
  const consumer = path.join(__dirname, '..', '..', 'web', 'server', 'lib', 'code-graph', 'runtime.js');
  return path.dirname(createRequire(consumer).resolve('typescript/package.json'));
};

module.exports = (context) => {
  const resourcesPath = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  copyTypescriptPlatformLibs(resourcesPath, resolveTypescriptDir());
  verifyPackagedAppContents(resourcesPath);
  if (context.electronPlatformName !== 'darwin') return;

  const sourceAssetsPath = path.join(__dirname, '..', 'resources', 'icons', 'Assets.car');

  if (!fs.existsSync(sourceAssetsPath)) {
    throw new Error(`Missing compiled app icon asset catalog at ${sourceAssetsPath}`);
  }

  fs.copyFileSync(sourceAssetsPath, path.join(resourcesPath, 'Assets.car'));
};
