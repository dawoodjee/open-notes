import React from 'react';
import { ScrollView, View } from 'react-native';
import { Check, List, Type } from 'lucide-react-native';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSubHeader,
} from '@/components/ui/settings-group';
import { Icon } from '@/components/ui/icon';
import { APP_THEMES } from '@/contexts/ThemeContext';
import type { AppTheme, BulletStyle, ThemePreference } from '@/contexts/ThemeContext';

const DARK_MODE_OPTIONS: { label: string; value: ThemePreference }[] = [
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
  theme,
  setTheme,
}: {
  onBack: () => void;
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => Promise<void>;
  bulletStyle: BulletStyle;
  setBulletStyle: (next: BulletStyle) => Promise<void>;
  theme: AppTheme;
  setTheme: (next: AppTheme) => Promise<void>;
}) {
  return (
    <>
      <SettingsSubHeader title="Appearance" onBack={onBack} />

      <ScrollView className="flex-1 px-5 pt-4 bg-background">
        {/* "Dark Mode", not "Theme". This control has only ever chosen between
            a light and a dark FACE; the group below chooses which light and
            which dark you get. They are independent, and naming them both
            "Theme" was what made that hard to see. */}
        <SettingsGroup footnote="Device follows your phone’s own light and dark setting, including its schedule.">
          <SettingsRow
            label="Dark Mode"
            right={
              <SettingsSegmented
                options={DARK_MODE_OPTIONS}
                value={preference}
                onChange={(next) => void setPreference(next)}
              />
            }
          />
        </SettingsGroup>

        {/* Rows rather than a segmented control: three of the four are not
            built yet, and a segmented control with most of its segments dead
            reads as broken rather than as forthcoming. Rows carry a reason. */}
        <SettingsGroup
          caption="Theme"
          footnote="Every theme has its own light and dark version — Dark Mode above chooses which one you see."
        >
          {APP_THEMES.map((t) => (
            <SettingsRow
              key={t.value}
              icon={t.icon}
              label={t.label}
              sublabel={t.available ? t.blurb : `${t.blurb} · Coming soon`}
              disabled={!t.available}
              onPress={t.available ? () => void setTheme(t.value) : undefined}
              right={
                theme === t.value ? (
                  <Icon as={Check} className="w-5 h-5 text-lime-600 dark:text-lime-400" />
                ) : undefined
              }
            />
          ))}
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
