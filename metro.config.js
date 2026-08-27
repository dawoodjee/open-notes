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
 * instead. `lib/powersync/openDatabase.web.ts` passes an explicit `worker` URL
 * pointing at the pre-bundled worker committed under `public/@powersync/`, so
 * the stub is never reached. (This comment used to say the database ran in the
 * tab with `useWebWorker: false`; Stage 13a moved it onto OPFS with a dedicated
 * worker, and running it in the tab is the configuration that CANNOT work here
 * -- see that file.)
 *
 * A targeted alias rather than adding 'react-native' to `unstable_conditionNames`:
 * that flag is global, and flipping every package on web onto its React Native
 * entry point to fix one of them is a much larger change than the problem.
 */
const powerSyncWebEntry = path.resolve(
  __dirname,
  'node_modules/@powersync/web/dist/index.react_native_web.js'
);

/**
 * `@tiptap/extensions` is installed where nothing can reach it.
 *
 * `react-native-enriched-html` is native on iOS and Android, but its WEB build
 * is a tiptap stack. npm hoisted SOME of that stack to the top level and left
 * the rest nested inside the library, and the two halves cannot see each other:
 *
 *   node_modules/@tiptap/extension-history        <- hoisted
 *     imports "@tiptap/extensions"
 *   node_modules/react-native-enriched-html/
 *     node_modules/@tiptap/extensions             <- nested, invisible from above
 *
 * Node's resolution walks UP from the importer, and the importer is the hoisted
 * copy, so the nested one is never on its path. The bundle died with
 * `Unable to resolve module @tiptap/extensions` before any app code ran. That is
 * the failure Stage 12b worked around by keeping the whole chain out of the web
 * bundle (see components/RichEditor.web.tsx), and it is why web has a plain-text
 * editor rather than the real one.
 *
 * It is NOT a version conflict -- every copy in the tree is 3.27.1, checked. It
 * is purely where npm put them. So an alias is a legitimate fix rather than a
 * papering-over: it points the name at the copy that is already installed and
 * already the right version.
 *
 * An alias rather than adding `@tiptap/extensions` to package.json, because a
 * new top-level dependency is Adam's call under the project's own rules, and
 * this needs no new package -- only a path.
 */
/**
 * A real file inside `react-native-enriched-html`, used only as a RESOLUTION
 * ORIGIN for `@tiptap/*`.
 *
 * Node resolves a bare specifier by walking UP from the importing file, so
 * asking Metro to resolve `@tiptap/core` as though it were being imported from
 * here checks `react-native-enriched-html/node_modules/@tiptap/` first and then
 * falls through to the top level. That gets BOTH halves of the split right
 * without a list: the nested packages are found nested, and `extension-history`
 * and `extension-text-align` -- which exist only at the top level -- are found
 * there, because the walk continues past the nested directory rather than
 * stopping at it.
 *
 * Two earlier attempts are worth recording, because each looked correct:
 *
 *   - Aliasing `@tiptap/extensions` to the nested directory fixed that one name
 *     and immediately produced `Unable to resolve @tiptap/core`, which is only
 *     at the top level. Whack-a-mole across a dozen packages.
 *   - Redirecting every nested-package NAME to its nested PATH broke subpath
 *     exports: the library imports `@tiptap/extensions/placeholder`, and a
 *     filesystem join bypasses the package's `exports` map, so Metro looked for
 *     a literal file called `placeholder`.
 *
 * Handing the ORIGIN to the resolver instead of a path keeps Node's own
 * algorithm -- exports maps, subpaths and the upward walk -- entirely intact.
 */
const tiptapResolutionOrigin = path.resolve(
  __dirname,
  'node_modules/react-native-enriched-html/lib/module/web/EnrichedTextInput.js'
);

/**
 * Only redirect while that origin genuinely exists. If the library is removed
 * or restructures its build output, pointing Metro at a missing file would turn
 * a resolution that works today into a confusing failure -- and the default
 * resolver is already correct in that case, because there would be no nested
 * copy to prefer.
 */
const redirectTiptap = require('fs').existsSync(tiptapResolutionOrigin);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === '@powersync/web') {
    return { type: 'sourceFile', filePath: powerSyncWebEntry };
  }
  if (redirectTiptap && platform === 'web' && moduleName.startsWith('@tiptap/')) {
    return context.resolveRequest(
      { ...context, originModulePath: tiptapResolutionOrigin },
      moduleName,
      platform
    );
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativewind(config, {
  input: './global.css',
  inlineRem: 16,
});
