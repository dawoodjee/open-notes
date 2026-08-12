import React from 'react';
import { ScrollView, View } from 'react-native';
import { List, Type } from 'lucide-react-native';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSubHeader,
} from '@/components/ui/settings-group';
import type { BulletStyle, ThemePreference } from '@/contexts/ThemeContext';

const THEME_OPTIONS: { label: string; value: ThemePreference }[] = [
  { label: 'Device', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

const BULLET_OPTIONS: { label: string; value: BulletStyle }[] = [
  { label: 'Dash', value: 'dash' },
  { label: 'Dot', value: 'dot' },
];

/**
 * Settings -> Appearance.
 *
 * TAKES THE PREFERENCE AS PROPS RATHER THAN CALLING useTheme(), for the same
 * reason SecurityView takes its lock settings as props: gluestack's <Modal>
 * hoists its children to an overlay root mounted above every provider in
 * app/_layout.tsx, so a context hook called in here finds nothing and throws.
 * Props survive the hoist because they're bound when the element is created,
 * in the normal tree.
 */
export function AppearanceView({
  onBack,
  preference,
  setPreference,
  bulletStyle,
  setBulletStyle,
}: {
  onBack: () => void;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => Promise<void>;
  bulletStyle: BulletStyle;
  setBulletStyle: (next: BulletStyle) => Promise<void>;
}) {
  return (
    <>
      <SettingsSubHeader title="Appearance" onBack={onBack} />

      <ScrollView className="flex-1 px-5 pt-4 bg-background">
        {/* No caption: it would read "THEME" directly above a row labelled
            "Theme". The row label alone is enough. */}
        <SettingsGroup footnote="Device follows your phone’s own light and dark setting, including its schedule.">
          <SettingsRow
            label="Theme"
            right={
              <SettingsSegmented
                options={THEME_OPTIONS}
                value={preference}
                onChange={(next) => void setPreference(next)}
              />
            }
          />
        </SettingsGroup>

        {/* Applies to every list in every note, because the editor only has
            one kind of bullet -- see BulletStyle. Notes themselves are
            untouched by this; it changes what gets drawn, not what is
            stored. */}
        <SettingsGroup
          caption="Editor"
          footnote="Applies to all bulleted lists, however they were made."
        >
          <SettingsRow
            icon={List}
            label="Bullets"
            right={
              <SettingsSegmented
                options={BULLET_OPTIONS}
                value={bulletStyle}
                onChange={(next) => void setBulletStyle(next)}
              />
            }
          />
        </SettingsGroup>

        {/* Still a placeholder, and still honest about it. */}
        <SettingsGroup caption="Text">
          <SettingsRow icon={Type} label="Fonts" disabled />
        </SettingsGroup>

        <View className="h-8" />
      </ScrollView>
    </>
  );
}
