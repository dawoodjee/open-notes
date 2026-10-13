import React, { createContext, useCallback, useContext } from 'react';
import { View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { PressableScale } from './PressableScale';
import { spring, SPRING_PRESS } from '@/lib/theme/motion';
import { haptics } from '@/lib/theme/haptics';
import { CAPSULE_PADDING, GROUP_GAP, SLOT, SURFACE } from '@/lib/layout/chromeMetrics';

/**
 * The one icon button. Every icon button in the app is this component.
 *
 * WHY IT EXISTS. Before this the tree had SEVEN different container treatments
 * and SIX different glyph sizes for what is conceptually one control --
 * `w-8 h-8 rounded-full border`, bare `44x44`, bare `44x36`,
 * `44x44 + bg-foreground/10`, `p-1.5 rounded-full active:bg-muted`,
 * `p-1.5 rounded-full hover:bg-muted`, and `w-10 h-10 rounded-full bg-lime-500`.
 * Two of those were hover-only, which on a phone means no press feedback at all.
 *
 * ── THE NUMBERS ARE MEASURED, NOT CHOSEN ──────────────────────────────────
 *
 * Read off `dev-docs/design/iteration-2/floating-menu/icon-buttons-groups-dark.png` (638x96, a 2x capture)
 * by sampling the actual pixels rather than eyeballing:
 *
 *   surfaces      three of them, every one exactly 72px tall
 *   circle        73px wide -- so a lone circle is just the surface height
 *   4-icon capsule  310px  ->  77.5px per icon
 *   2-icon capsule  160px  ->  80px per icon
 *   gaps          83->120 and 429->466, both 37px
 *   inset pill    fill level 55 against a 35 capsule, spanning 51px vertically
 *
 * At 2x that is 36pt surfaces, ~39pt per icon slot, 18pt gaps and a ~26pt
 * inset. The capsule is exactly N x slot with no end padding -- its rounded
 * ends come from a radius of half its height.
 *
 * ── PAINTED SIZE IS NOT THE TOUCH TARGET ──────────────────────────────────
 *
 * This is the actual fix for "the back button container seems too large".
 * `HeaderCircleButton` painted a 44x44 circle because 44 was read as the HIG
 * minimum. 44pt is the minimum TOUCH target; Apple paints these at 36 and
 * extends the hit area invisibly. So: paint 36, restore 44 with `hitSlop`.
 *
 * ── FIVE STATES ───────────────────────────────────────────────────────────
 *
 * Stage 9 shipped the motion half of this (`SPRING_PRESS`/`PRESS_SCALE`). The
 * background half did not exist until now.
 *
 *   rest      nothing behind the glyph
 *   hover     a rounded SQUARE behind that one glyph, inset from the surface
 *   press     the same square, more prominent
 *   selected  a filled accent CIRCLE
 *   disabled  dimmed glyph, no background, no press, no haptic
 *
 * Hover and selected are different SHAPES, not just different fills, which is
 * how the references draw them -- the hovered `Aa` in
 * `icon-buttons-groups-dark.png` is a rounded square, the active `B` in
 * `mobile-navbar-default-aa-undo-redo.png` is a circle. That difference is
 * what stops a hovered button reading as toggled on, which the plan flagged as
 * this system's most likely failure.
 */

// SURFACE, SLOT and GROUP_GAP are defined in lib/layout/chromeMetrics.ts (so
// pure layout rules can use them under test) and re-exported here, where every
// component already imports them from.
export { GROUP_GAP, SLOT, SURFACE };
/** The hover/press/selected shape behind a single glyph. ~51px in a 2x reference. */
const INSET = 28;
/** The one glyph size in the app. */
export const GLYPH = 20;
/** Painted 36, touched 44. */
const HIT_SLOP = (44 - SURFACE) / 2;

/**
 * True when this button sits inside a capsule with siblings, in which case the
 * CAPSULE owns the surface and the button paints only its inset. A lone button
 * -- including a lone child of a group -- paints its own circle.
 */
const InCapsule = createContext(false);

export type IconButtonProps = {
  icon: React.ComponentType<any>;
  /** Spoken by screen readers and used as the hit-test name in tests. */
  label: string;
  /** Toggled ON. Draws the filled accent circle. */
  selected?: boolean;
  /**
   * A primary/confirm action: a filled accent circle that stands alone and is
   * never absorbed into a capsule, per the reference's Done button.
   */
  variant?: 'plain' | 'accent';
  disabled?: boolean;
  /**
   * WHY a disabled button needs to say which KIND of disabled it is. Two
   * different things dim a control and they look identical on purpose:
   * a format the editor cannot do at all yet (highlight, colour, indent,
   * outdent, table -- rendered so the toolbar's layout is final), and a format
   * that is merely inapplicable where the caret currently is (`isBlocking`
   * from the editor's `onChangeState`). A screen reader announcing "dimmed"
   * for both, with no way to tell them apart, is a worse experience than the
   * sighted one. This becomes the accessibility hint.
   */
  disabledReason?: string;
  /**
   * `'none'` drops the circle/capsule fill and keeps only the hover/press
   * inset. For controls that live INSIDE another surface -- a folder row's
   * disclosure chevron, its reorder arrows -- where a filled circle would read
   * as a button floating on top of the row rather than part of it. Apple draws
   * these bare too.
   *
   * They still get the inset, which is the point: bare used to mean NO press
   * feedback whatsoever, the same defect as the hover-only buttons.
   */
  surface?: 'auto' | 'none';
  /**
   * An animated style for the glyph itself, for the one case that needs it:
   * the folder chevron rotates 90 degrees on expand, and the turn is what
   * tells you the row opened.
   */
  glyphStyle?: StyleProp<ViewStyle>;
} & Omit<PressableProps, 'children' | 'style' | 'disabled'>;

/**
 * `forwardRef` because a Gluestack `Menu` hands its trigger a ref -- it needs
 * the real native node to measure where to draw the popover -- bundled in the
 * same props object as its `onPress`. A plain function component drops an
 * incoming ref silently, and the menu then has nothing to position against.
 * `PressableScale` underneath already forwards for the same reason.
 */
export const IconButton = React.forwardRef<View, IconButtonProps>(function IconButton({
  icon,
  label,
  selected = false,
  variant = 'plain',
  disabled = false,
  disabledReason,
  surface = 'auto',
  glyphStyle,
  onPressIn,
  onPressOut,
  ...rest
}, ref) {
  const inCapsule = useContext(InCapsule);

  /**
   * Both held as shared values rather than React state. Hover and press fire
   * on every pointer move in and out of ~40 buttons; re-rendering the tree for
   * a background colour is work the UI thread can do on its own.
   */
  const hovered = useSharedValue(0);
  const pressed = useSharedValue(0);

  /**
   * HAPTICS FIRE ON PRESS-IN, not on press.
   *
   * Press-in is the moment the finger lands, and that is when the physical
   * feedback has to arrive or it reads as lag rather than as touch. `onPress`
   * fires on RELEASE, which is tens of milliseconds late and — worse — does not
   * fire at all if the finger slides off, so a button would feel dead for the
   * exact gesture where reassurance matters most.
   *
   * Disabled buttons are excluded by Pressable itself: it calls neither
   * handler, which is the behaviour the icon-button spec asks for ("no press,
   * no haptic") without a check here.
   *
   * Every icon button gets the SAME tap, deliberately. An earlier version tried
   * to pick a firmer one for toggles using `selected`, which cannot work: this
   * component cannot tell a toggle that is currently off from a plain action
   * button — both arrive as `selected={false}` — so it would have made Share
   * feel like switching bold on. The stronger meanings in
   * `lib/theme/haptics.ts` belong at the call sites that actually know: Replace
   * All commits, stepping through matches steps.
   */
  const handlePressIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
    (e) => {
      pressed.value = spring(1, SPRING_PRESS);
      haptics.tap();
      onPressIn?.(e);
    },
    [onPressIn, pressed]
  );
  const handlePressOut = useCallback<NonNullable<PressableProps['onPressOut']>>(
    (e) => {
      pressed.value = spring(0, SPRING_PRESS);
      onPressOut?.(e);
    },
    [onPressOut, pressed]
  );

  /**
   * ONE overlay carrying BOTH states, because they stack: pressing a hovered
   * button should land somewhere past hover, not replace it.
   *
   * Spelled as an animated opacity over a token fill rather than with
   * `interpolateColor`, because the fill is `bg-foreground` -- it flips with
   * the theme on its own. Interpolating would mean hardcoding two hex values
   * per scheme and keeping them in step with global.css by hand.
   *
   * The opacity must be the ONLY thing setting opacity on this view. An
   * animated style and a static one on the same view is the trap documented on
   * PressableScale: whichever loses is silently dropped, with no error.
   */
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: hovered.value * 0.1 + pressed.value * 0.16,
  }));

  const accent = variant === 'accent' || selected;

  /** The inset: a rounded square for hover/press, a circle when selected. */
  const inset: ViewStyle = {
    width: INSET,
    height: INSET,
    borderRadius: selected ? INSET / 2 : 9,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  const glyph = (
    <View style={inset} className={selected ? 'bg-lime-500' : undefined}>
      {/* Not rendered at all when selected or disabled: a toggled button has
          its own solid fill and must not also brighten under a cursor, or it
          reads as about to do something else; a disabled one must not react
          to a pointer at all. */}
      {!selected && !disabled ? (
        <Animated.View
          pointerEvents="none"
          style={[{ ...inset, position: 'absolute' }, overlayStyle]}
          className="bg-foreground"
        />
      ) : null}
      <AnimatedIconWrapper style={glyphStyle}>
      <Icon
        as={icon}
        style={{ width: GLYPH, height: GLYPH }}
        className={
          disabled
            ? 'text-muted-foreground opacity-60'
            : accent
              ? 'text-on-accent'
              : 'text-foreground'
        }
      />
      </AnimatedIconWrapper>
    </View>
  );

  /**
   * A lone button paints its own surface. Inside a capsule the capsule already
   * did, and a second one would read as a button-within-a-button. An accent
   * button always paints its own -- it is never absorbed.
   */
  const paintsSurface = surface !== 'none' && (!inCapsule || variant === 'accent');

  return (
    <PressableScale
      ref={ref}
      disabled={disabled}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      onHoverIn={() => {
        hovered.value = spring(1, SPRING_PRESS);
      }}
      onHoverOut={() => {
        hovered.value = spring(0, SPRING_PRESS);
      }}
      hitSlop={HIT_SLOP}
      containerStyle={{ width: inCapsule ? SLOT : SURFACE, height: SURFACE }}
      style={{
        width: inCapsule ? SLOT : SURFACE,
        height: SURFACE,
        borderRadius: SURFACE / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      className={
        paintsSurface
          ? variant === 'accent'
            ? 'bg-lime-500'
            : 'bg-foreground/10'
          : undefined
      }
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      accessibilityHint={disabled ? disabledReason : undefined}
      {...rest}
    >
      {glyph}
    </PressableScale>
  );
});

IconButton.displayName = 'IconButton';

/** Only wraps when there is something to animate, so the common case adds no view. */
function AnimatedIconWrapper({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  if (!style) return <>{children}</>;
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * A row of related icon buttons sharing ONE capsule.
 *
 * GROUPING IS SEMANTIC, NOT SPATIAL, and the reference is explicit about it:
 * in `icon-buttons-editor-accent.png` Undo keeps its own circle immediately
 * beside a Share/`…` capsule. Being adjacent is not what merges controls --
 * being *related* is, and that is a judgment call per bar rather than a layout
 * rule. So this component never decides grouping; the caller does, by choosing
 * what to put inside it.
 *
 * One child gets a circle instead of a capsule, so a group whose members are
 * conditional collapses correctly on its own when only one survives.
 */
export function IconButtonGroup({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const isCapsule = items.length > 1;

  return (
    <InCapsule.Provider value={isCapsule}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: SURFACE,
          borderRadius: SURFACE / 2,
          // A row inside a COLUMN parent stretches to full width by default,
          // which turned a 4-icon capsule into a 368pt bar. It must always be
          // exactly as wide as the icons it holds.
          alignSelf: 'flex-start',
          // The reference leaves ~10pt between the capsule's rounded end and
          // the first inset. A centred 28pt inset in a 39pt slot only gives
          // 5.5, so the end caps get the difference.
          paddingHorizontal: isCapsule ? CAPSULE_PADDING : 0,
        }}
        className={isCapsule ? 'bg-foreground/10' : undefined}
      >
        {items}
      </View>
    </InCapsule.Provider>
  );
}

/**
 * A row of groups, spaced by the reference's own 18pt gap. Exists so no bar
 * has to re-derive the spacing, and so every bar in the app agrees on it.
 */
export function IconButtonBar({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: GROUP_GAP }, style]}>
      {children}
    </View>
  );
}
