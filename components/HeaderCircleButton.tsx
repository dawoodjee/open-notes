import React from 'react';
import { Icon } from '@/components/ui/icon';
import { PressableScale } from './PressableScale';

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
 * THE FILL IS TRANSLUCENT ON PURPOSE. `bg-foreground/10` is a tenth of
 * whatever the text colour currently is, so it lands as a light grey circle in
 * light mode and a lifted grey one on a dark background -- one token, correct
 * in both, and no new palette entry. Stage 9's contrast audit documents
 * translucent values as the allowed exception to the pure-value ban, and this
 * is the case that exception exists for.
 */
export function HeaderCircleButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: React.ComponentType<any>;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      // 44x44 exactly, which is both the HIG minimum touch target and the
      // size the reference draws these at -- no padding-based approximation,
      // since RN does not grow a hit area from padding alone.
      containerStyle={{ width: 44, height: 44 }}
      style={{ width: 44, height: 44 }}
      className="rounded-full bg-foreground/10 items-center justify-center"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon as={icon} className="w-6 h-6 text-foreground" />
    </PressableScale>
  );
}
