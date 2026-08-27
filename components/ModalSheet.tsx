/**
 * The bottom sheet, behind a platform seam.
 *
 * `@swmansion/react-native-bottom-sheet` is a Fabric component with no web
 * implementation: importing it on web reaches `codegenNativeComponent`, which
 * react-native-web does not provide, and the bundle dies with
 * `(0, _reactNativeWebDistIndex.codegenNativeComponent) is not a function`
 * before any app code runs. That took web from working (Stage 12g) back to a
 * red error screen the moment 12.5 swapped both sheets onto the native one --
 * caught by running the browser, which is exactly why the browser is in the
 * verification loop rather than treated as the platform nobody checks.
 *
 * A `.web.tsx` sibling is the whole fix: Metro resolves the platform file, so
 * the native module is never in the web bundle at all. Guarding at the call
 * site would not have worked -- the throw is at import.
 */
export { ModalBottomSheet } from '@swmansion/react-native-bottom-sheet';
