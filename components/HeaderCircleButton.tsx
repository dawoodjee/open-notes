import React from 'react';
import type { View } from 'react-native';
import { IconButton, type IconButtonProps } from './IconButton';

/**
 * The round header button iOS uses at the top of a pushed screen.
 *
 * WHY THIS EXISTS AS ITS OWN COMPONENT: the folder navigation control started
 * as a bare sidebar-toggle glyph sitting inline beside the title. That is a
 * SPLIT-VIEW idiom -- it means "show/hide the pane next to this one", which is
 * true on a desktop or an iPad in landscape and false on a phone, where the
 * folder list is a screen you came FROM. On a phone the honest control is a
 * back button, and iOS draws that as a filled circle in its own row above the
 * large title, not as an icon inline with it.
 *
 * So both treatments are kept, each where it is true: wide layouts keep the
 * inline split-view control, phones get this.
 *
 * NOW A THIN WRAPPER over the shared icon-button primitive (Stage 12a). It used
 * to own its own 44x44 circle, `bg-foreground/10` fill and `w-6 h-6` glyph --
 * one of the seven container treatments the primitive replaces. Two things
 * changed as a result and both are deliberate:
 *
 *  - **It paints smaller.** 44 was read as the HIG minimum and used as a
 *    painted size; 44pt is the minimum TOUCH target. The primitive paints 36
 *    and restores 44 with `hitSlop`, which is the actual fix for "the back
 *    button container seems too large".
 *  - **The glyph shrank from 24 to 20**, the app's one glyph size.
 *
 * Kept rather than folded into `IconButton` at every call site because the name
 * is the documentation: it says "this is the pushed-screen back affordance",
 * which is a decision, not a shape.
 */
export const HeaderCircleButton = React.forwardRef<
  View,
  Omit<IconButtonProps, 'label'> & { accessibilityLabel: string }
>(function HeaderCircleButton({ icon, accessibilityLabel, ...rest }, ref) {
  return <IconButton ref={ref} icon={icon} label={accessibilityLabel} {...rest} />;
});

HeaderCircleButton.displayName = 'HeaderCircleButton';
