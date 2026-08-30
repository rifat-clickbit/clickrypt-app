const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const openpgpLightweightPath = path.resolve(
  __dirname,
  'node_modules/openpgp/dist/openpgp.min.mjs'
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'openpgp' || moduleName.startsWith('openpgp/')) {
    return {
      filePath: openpgpLightweightPath,
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
