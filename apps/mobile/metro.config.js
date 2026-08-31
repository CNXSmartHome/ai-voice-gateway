// Metro in an npm workspace.
//
// Dependencies are hoisted to the repository root, which Metro does not look
// in by default, so both locations are declared and the workspace root is
// watched for changes. Hierarchical lookup is disabled so a module resolves
// from exactly one of them -- with it on, a package present in both places
// can be loaded twice, which for React or React Native means a runtime that
// disagrees with itself.
const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
