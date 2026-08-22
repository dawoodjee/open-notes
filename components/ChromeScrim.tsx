import React from 'react';
import { View } from 'react-native';

/**
 * The gradient behind a floating bar.
 *
 * NOT DECORATION -- it is what keeps the controls readable. A floating bar has
 * the note's own text running underneath it once scrolled, and without a ground
 * the paragraphs thread between the capsules and the glyphs stop being legible
 * against them. Found by scrolling the desktop harness, not by reasoning about
 * it.
 *
 * Built from stacked strips of `bg-background` at falling opacity rather than
 * with `expo-linear-gradient`, because that is another native module and
 * another rebuild for one gradient. Because every strip is the `background`
 * TOKEN it is theme-tinted for free and flips with dark mode on its own.
 *
 * Shared by the desktop top bar and the phone nav bar so the two cannot drift
 * apart -- they are the same idea at two widths.
 */

/** How far past the bar the scrim keeps fading. */
const FADE = 24;
/** Strips in the fade. Enough that the banding is invisible, few enough that
 *  it costs nothing -- 12 views is less than one icon button. */
const STEPS = 12;

export function ChromeScrim({ height }: { height: number }) {
  const total = height + FADE;
  const step = total / STEPS;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: total }}
    >
      {Array.from({ length: STEPS }, (_, i) => {
        // Solid across the bar itself, then easing out through the fade, so the
        // controls always sit on a full-strength ground.
        const progress = i / (STEPS - 1);
        const solidUntil = height / total;
        const opacity =
          progress <= solidUntil ? 1 : 1 - (progress - solidUntil) / (1 - solidUntil);
        return (
          <View
            key={i}
            className="bg-background"
            style={{
              position: 'absolute',
              top: i * step,
              left: 0,
              right: 0,
              // +1 so neighbouring strips overlap rather than leaving hairlines
              // between them at fractional pixel positions.
              height: step + 1,
              opacity,
            }}
          />
        );
      })}
    </View>
  );
}
