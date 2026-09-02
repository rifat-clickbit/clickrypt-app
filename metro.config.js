const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const openpgpSourcePath = path.resolve(
  __dirname,
  'node_modules/openpgp/dist/openpgp.mjs'
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Use the full, unminified ESM build. The minified build breaks at runtime
  // under Hermes/Metro (PacketList methods like filterByTag become undefined).
  if (moduleName === 'openpgp') {
    return {
      filePath: openpgpSourcePath,
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
