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

module.exports = withNativewind(config, {
  input: './global.css',
  inlineRem: 16,
});
