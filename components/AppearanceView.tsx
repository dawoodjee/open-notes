import React from 'react';
import { ScrollView, View } from 'react-native';
import { Palette, Type } from 'lucide-react-native';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSubHeader,
} from '@/components/ui/settings-group';
import type { ThemePreference } from '@/contexts/ThemeContext';

const THEME_OPTIONS: { label: string; value: ThemePreference }[] = [
  { label: 'Device', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
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
}: {
  onBack: () => void;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => Promise<void>;
}) {
  return (
    <>
      <SettingsSubHeader title="Appearance" icon={Palette} onBack={onBack} />

      <ScrollView className="flex-1 px-5 pt-4 bg-background">
        <SettingsGroup
          caption="Theme"
          footnote="Device follows your phone’s own light and dark setting, including its schedule."
        >
          <SettingsRow
            icon={Palette}
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

        {/* Still a placeholder, and still honest about it. */}
        <SettingsGroup caption="Text">
          <SettingsRow icon={Type} label="Fonts" disabled />
        </SettingsGroup>

        <View className="h-8" />
      </ScrollView>
    </>
  );
}
