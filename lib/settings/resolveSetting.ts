/**
 * Which of three candidate values wins: the synced mirror, the pre-13c key, or
 * the default.
 *
 * ── WHY THIS IS A SEPARATE, PURE FUNCTION ─────────────────────────────────
 *
 * Because the alternative was not testable, and the attempt to test it by hand
 * failed in a way worth recording. Stage 13c moved three appearance
 * preferences onto synced keys, which meant every existing device had to keep
 * reading its OLD key until it next wrote. To check that, the app was launched
 * on an iPhone that had been running the previous build: it came up dark, the
 * device was dark, and that looked like proof.
 *
 * It was not. Flipping the simulator to light flipped the app too -- so that
 * device's stored preference had been `'system'` all along, and `'system'`,
 * `'missing'` and `'fell back correctly'` are indistinguishable from the
 * outside. The observation had no power to detect the bug it was meant to
 * catch.
 *
 * So the precedence lives here, where four lines of test cover every branch,
 * and `appearanceSettings.ts` supplies the I/O around it.
 */

/**
 * @param mirrored   the synced value, or null when nothing has been written
 * @param legacy     the pre-13c value, or null
 * @param isValid    a value can arrive from another device on a different
 *                   build; a theme this binary cannot paint would render
 *                   nothing and look like a bug
 * @param fallback   used when neither candidate is present AND valid
 */
export function resolveSetting<T extends string>(
  mirrored: string | null,
  legacy: string | null,
  isValid: (value: string) => value is T,
  fallback: T
): T {
  // The mirror wins whenever it holds something usable -- it is the only one of
  // the two that sync ever updates.
  if (mirrored !== null && isValid(mirrored)) return mirrored;

  // An INVALID mirror falls through to the legacy value rather than to the
  // default. A value this build cannot use is not evidence that the user's
  // older, still-valid choice should be discarded.
  if (legacy !== null && isValid(legacy)) return legacy;

  return fallback;
}
