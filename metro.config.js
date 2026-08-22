const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];

/**
 * Hide agent worktrees from Metro.
 *
 * Subagent sessions get their own git worktree, and those are created UNDER
 * this project at .claude/worktrees/<name>/ -- which means each one is a
 * complete second copy of app/, components/, contexts/ and lib/, checked out
 * at whatever commit that agent branched from.
 *
 * Metro crawls the whole project directory, so without this it indexes both
 * copies and can resolve modules out of the stale one. The symptom is brutal
 * to diagnose from the app: it looks like your work vanished. Committed code
 * is fine, the files on disk are fine, but the running bundle is built partly
 * from a snapshot of an older commit -- so features come back "undone", state
 * reads wrong, and nothing in git explains any of it. That is exactly what
 * happened here, with a worktree branched from the pre-branch merge commit.
 *
 * blockList takes regexes matched against absolute paths.
 */
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  new RegExp(`^${path.resolve(__dirname, '.claude').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.*`),
];

/**
 * `@powersync/web` on web has to be the React-Native-Web build, not the default one.
 *
 * The SDK ships two entry points and picks between them with an export CONDITION
 * (`"react-native-web": "./dist/index.react_native_web.js"`). Metro does not apply
 * that condition on the web platform, so it resolved the default build -- which
 * spawns its database worker with `new Worker(new URL('./worker.js', import.meta.url))`.
 * Metro emits a classic script, not an ES module, so the page died at parse time
 * with `Cannot use 'import.meta' outside a module` before a line of app code ran.
 *
 * The React-Native-Web build is the SDK's own answer to exactly this: a rollup
 * plugin replaces that worker spawner with a stub that throws a readable error
 * instead. `lib/powersync/openDatabase.web.ts` runs the database in the tab
 * (`useWebWorker: false`, `enableMultiTabs: false`), so the stub is never reached.
 *
 * A targeted alias rather than adding 'react-native' to `unstable_conditionNames`:
 * that flag is global, and flipping every package on web onto its React Native
 * entry point to fix one of them is a much larger change than the problem.
 */
const powerSyncWebEntry = path.resolve(
  __dirname,
  'node_modules/@powersync/web/dist/index.react_native_web.js'
);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === '@powersync/web') {
    return { type: 'sourceFile', filePath: powerSyncWebEntry };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativewind(config, {
  input: './global.css',
  inlineRem: 16,
});
