# Vendored `ReanimatedSwipeable`

Copied verbatim from **`react-native-gesture-handler@2.28.0`**
(`src/components/ReanimatedSwipeable/`) on 2026-08-22, then modified in three
places. Everything else -- structure, naming, comments, formatting -- is left
exactly as upstream wrote it so this stays diffable against a future release.

## Why it is vendored rather than imported

**1. Left-hand actions do not receive taps.**
Upstream [issue #3223](https://github.com/software-mansion/react-native-gesture-handler/issues/3223),
fixed by [PR #4192](https://github.com/software-mansion/react-native-gesture-handler/pull/4192).
Both action panels are laid out as `StyleSheet.absoluteFillObject` siblings that
each cover the entire row. The hidden one is only hidden by `opacity: 0`, and an
opacity-0 view still hit-tests -- so whichever panel renders last sits on top and
swallows every tap meant for the other one.

**PR #4192 merged 2026-06-16. RNGH 2.32.0, the highest 2.x, shipped 2026-06-11.**
No 2.x release contains the fix, and RNGH 3.x requires React Native >= 0.82 while
this project is on 0.81.5 (Expo SDK 54 pins `~2.28.0`). So the fix is genuinely
unreachable without an SDK upgrade, which is its own project.

**2. There is no full swipe.** Dragging *past* the revealed actions and letting go
should fire the outermost action instead of leaving the row parked open. That is
[discussion #2520](https://github.com/software-mansion/react-native-gesture-handler/discussions/2520),
still an open request in current 3.x.

## The three modifications

Each is marked in the source with a `// VENDORED:` comment.

1. **Imports** rewritten from the library's internal relative paths to the public
   package entry point. `applyRelationProp` is internal to the package, so it is
   inlined verbatim at the bottom of `ReanimatedSwipeableProps.ts`.
2. **PR #4192's own fix** applied: `pointerEvents: 'none'` on an action container
   while its progress is 0. This is upstream's change, not a different one
   invented here -- and it matches the existing idiom in this same file, which
   already animates `pointerEvents` on the children container.
3. **Full swipe**, as three new props: `fullSwipeLeftThreshold`,
   `fullSwipeRightThreshold`, `onFullSwipe`. Implemented inside `handleRelease`,
   where the release distance is already computed, and following the naming and
   callback conventions of the `leftThreshold` / `rightThreshold` /
   `onSwipeableOpen` props next to it.

## Delete this directory when

Expo moves this project to React Native >= 0.82. At that point RNGH 3.x has the
pointer-events fix, and `ReanimatedSwipeable` can be imported from the package
again -- full swipe would still need to live somewhere, but on far less code.
