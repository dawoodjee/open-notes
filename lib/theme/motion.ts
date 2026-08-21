import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing, ReduceMotion, withSpring, withTiming } from 'react-native-reanimated';
import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

/**
 * Shared motion primitives.
 *
 * Every animation in the app pulls its timing from here rather than picking
 * its own numbers, so "how does this app move" is one decision made once
 * instead of a per-component accident. Stages 10-12 (folder collapse, list
 * transitions, menu expand/collapse) are the intended consumers.
 *
 * WHY SPRINGS ARE SPECIFIED AS duration + dampingRatio, not damping /
 * stiffness / mass: the physical form is three coupled numbers where changing
 * one changes the perceived speed of the other two, so tuning it is guesswork.
 * The duration form says the two things a designer actually means -- how long
 * it takes, and how much it overshoots -- and Reanimated solves for the
 * physics. It also maps 1:1 onto SwiftUI's own spring API
 * (`.spring(duration:bounce:)`, where `bounce = 1 - dampingRatio`), which is
 * what makes the values below traceable to Apple rather than invented.
 *
 * PROVENANCE, stated honestly: the apple-design-system skill specifies the
 * DURATIONS and EASINGS below verbatim (references/animation-guide.md), but
 * supplies no spring parameters at all -- it is written web-CSS-first, where
 * springs barely exist, and it actively discourages them. The spring configs
 * here are therefore grounded in SwiftUI's named presets (.smooth / .snappy /
 * .bouncy) instead. That is a deliberate departure, taken because UIKit and
 * SwiftUI are themselves spring-driven, so matching iOS means using springs.
 * Retuning is cheap precisely because every consumer reads from this module.
 */

// ─── Durations (skill: references/animation-guide.md) ──────────────────────

export const DURATION = {
  /** Micro-interactions: press, focus, toggle. */
  fast: 150,
  /** Standard transitions: modals, cards, menus. */
  base: 300,
  /** Complex or multi-property animations. */
  slow: 500,
} as const;

// ─── Easings (skill: references/animation-guide.md) ────────────────────────
//
// cubic-bezier values transcribed directly; Easing.bezier is Reanimated's
// equivalent of the CSS function.

export const EASE = {
  /** The default for nearly everything. cubic-bezier(0.4, 0, 0.2, 1) */
  inOut: Easing.bezier(0.4, 0, 0.2, 1),
  /** Entrances. cubic-bezier(0, 0, 0.2, 1) */
  out: Easing.bezier(0, 0, 0.2, 1),
  /** Exits. cubic-bezier(0.4, 0, 1, 1) */
  in: Easing.bezier(0.4, 0, 1, 1),
} as const;

// ─── Springs (grounded in SwiftUI presets -- see PROVENANCE above) ─────────

/**
 * Press and release feedback. Critically damped: dampingRatio 1 means it
 * settles without overshoot, which is what a tap should feel like -- a button
 * that bounces back past its resting size reads as a toy.
 * SwiftUI equivalent: .smooth, shortened.
 */
export const SPRING_PRESS: WithSpringConfig = {
  duration: 250,
  dampingRatio: 1,
};

/**
 * Expand and collapse -- folder disclosure, menu open/close.
 * A little overshoot (bounce 0.15) makes the surface feel like it has weight
 * and is settling into place rather than snapping to a stop.
 * SwiftUI equivalent: .snappy.
 */
export const SPRING_EXPAND: WithSpringConfig = {
  duration: 350,
  dampingRatio: 0.85,
};

/**
 * Reserved for genuinely playful, low-stakes moments. Deliberately the only
 * config here with real bounce, and deliberately not the default for anything
 * -- the skill's warning about spring easing (animation-guide.md "Don't")
 * applies squarely to this one.
 * SwiftUI equivalent: .bouncy.
 */
export const SPRING_EMPHASISED: WithSpringConfig = {
  duration: 500,
  dampingRatio: 0.7,
};

/** The scale a pressable settles to while held. */
export const PRESS_SCALE = 0.97;

// ─── Reduced motion ────────────────────────────────────────────────────────

/**
 * Respecting the OS "Reduce Motion" setting is non-negotiable per the skill,
 * and doing it here means Stages 10-12 inherit it instead of each re-solving
 * it (or, more likely, forgetting).
 *
 * Two layers, because they cover different things:
 *
 * 1. `ReduceMotion.System` on every config below hands the decision to
 *    Reanimated itself, which reads the OS setting natively on the UI thread.
 *    This is the one that actually matters, and it needs no React state.
 * 2. `useReducedMotion()` for the cases Reanimated cannot resolve for us --
 *    deciding not to run an animation at all, or swapping a slide for a
 *    cross-fade. Reanimated ships its own hook of this name; this one exists
 *    so consumers have a single import surface and so the JS-side value stays
 *    in step with the native setting when the user changes it mid-session.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setReduced(value);
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduced;
}

// ─── Ready-made animation helpers ──────────────────────────────────────────
//
// Thin wrappers so a consumer writes `spring(1)` rather than repeating the
// config object at every call site -- which is how per-component drift starts.
// All of them defer to the OS reduce-motion setting via ReduceMotion.System.

/** Spring to a value using one of the configs above. Defaults to press feel. */
export function spring(toValue: number, config: WithSpringConfig = SPRING_PRESS) {
  'worklet';
  return withSpring(toValue, { ...config, reduceMotion: ReduceMotion.System });
}

/** Timed transition. Defaults to the skill's base duration and default easing. */
export function timing(
  toValue: number,
  config: WithTimingConfig = { duration: DURATION.base, easing: EASE.inOut }
) {
  'worklet';
  return withTiming(toValue, { ...config, reduceMotion: ReduceMotion.System });
}
