import React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';

/**
 * iOS grouped-list primitives, used identically on both platforms.
 *
 * Deliberately NOT Material on Android. One visual language means one set of
 * spacing decisions to keep straight, and a notes app has no reason to look
 * like two different products depending on the phone. The tokens here are
 * lifted from components/ManageAccountDialog.tsx so the settings sheets and
 * the account sheet agree: text-base/text-foreground for labels,
 * text-xs/text-muted-foreground for secondary text, rounded-2xl for
 * containers.
 *
 * Colours are semantic tokens (bg-background, text-foreground, border-border,
 * ...) rather than literal palette classes, because those tokens are defined
 * for BOTH schemes in global.css and flip on their own. A literal bg-white
 * cannot follow a theme; bg-background already does.
 */

/** A captioned card. Separators are drawn BETWEEN children, never after the
 *  last one -- a trailing hairline is the giveaway of a hand-rolled list. */
export function SettingsGroup({
  caption,
  footnote,
  children,
}: {
  caption?: string;
  footnote?: string;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children).filter(Boolean);

  return (
    <View className="mb-6">
      {caption ? (
        <RNText className="text-xs font-semibold text-muted-foreground uppercase mb-2 px-1">
          {caption}
        </RNText>
      ) : null}

      <View className="bg-card rounded-2xl overflow-hidden">
        {items.map((child, index) => (
          <View
            key={index}
            className={index < items.length - 1 ? 'border-b border-border' : undefined}
          >
            {child}
          </View>
        ))}
      </View>

      {/* Sits outside the card, in the muted caption style -- this is where
          the honest disclosures live, and they should read as explanation
          rather than as another row you can tap. */}
      {footnote ? (
        <RNText className="text-xs text-muted-foreground mt-2 px-1 leading-4">{footnote}</RNText>
      ) : null}
    </View>
  );
}

export function SettingsRow({
  icon,
  label,
  sublabel,
  value,
  right,
  onPress,
  disabled,
  destructive,
}: {
  /** Leading glyph, matching the one on this row's pushed view header. */
  icon?: React.ComponentType<any>;
  label: string;
  sublabel?: string;
  /** Right-aligned secondary text, e.g. the current selection. */
  value?: string;
  /** A control (Switch, button). Takes precedence over `value`. */
  right?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  const body = (
    <View className="flex-row items-center justify-between px-4 py-3">
      {icon ? (
        <Icon
          as={icon}
          className={`w-5 h-5 mr-3 ${
            disabled ? 'text-muted-foreground/50' : destructive ? 'text-destructive/70' : 'text-muted-foreground'
          }`}
        />
      ) : null}
      <View className="flex-1 pr-3">
        <RNText
          className={`text-base ${
            disabled ? 'text-muted-foreground' : destructive ? 'text-destructive' : 'text-foreground'
          }`}
        >
          {label}
        </RNText>
        {sublabel ? (
          <RNText className="text-xs text-muted-foreground mt-0.5 leading-4">{sublabel}</RNText>
        ) : null}
      </View>

      {right ?? (
        <View className="flex-row items-center gap-1">
          {value ? <RNText className="text-sm text-muted-foreground">{value}</RNText> : null}
          {onPress ? <Icon as={ChevronRight} className="text-muted-foreground/60 w-4 h-4" /> : null}
        </View>
      )}
    </View>
  );

  // A row with a control but no onPress must not be pressable, or the whole
  // row swallows taps meant for the switch beside it.
  if (!onPress) return body;

  return (
    <Pressable onPress={onPress} disabled={disabled} className="active:bg-accent">
      {body}
    </Pressable>
  );
}

/**
 * An iOS-style toggle, hand-built rather than either available Switch.
 *
 * Not gluestack's <Switch>: it wraps React Native's Switch through
 * withStyleContext, and inside a hoisted modal overlay it did not respond to
 * taps at all -- verified on device, the row's own controls worked while the
 * switch stayed put.
 *
 * Not React Native's <Switch> either: that renders a Material switch on
 * Android, and this app deliberately wears the same face on both platforms.
 * Twenty lines of View is the cheaper way to keep that promise.
 */
export function SettingsToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      hitSlop={8}
      className={`w-[51px] h-[31px] rounded-full justify-center px-[2px] ${
        value ? 'bg-green-500' : 'bg-muted-foreground/40'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <View
        className={`w-[27px] h-[27px] rounded-full bg-white dark:bg-neutral-100 ${value ? 'self-end' : 'self-start'}`}
      />
    </Pressable>
  );
}

/**
 * Inline segmented picker for short, mutually exclusive choices.
 *
 * Used instead of pushing a whole sub-screen for three options: the choice is
 * cheap to change and cheaper to see at a glance, and a drill-down for
 * "5 minutes vs 1 hour" costs two taps to learn nothing.
 */
export function SettingsSegmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className={`flex-row bg-muted rounded-xl p-0.5 ${disabled ? 'opacity-40' : ''}`}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-[10px] ${selected ? 'bg-background' : ''}`}
          >
            <RNText
              className={`text-xs ${selected ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              {option.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Header for a pushed sub-view inside a settings sheet.
 *
 * Paints its own white background rather than inheriting the sheet's. Under
 * NativeWind v5-preview the ModalContent's background does not reach a
 * fragment child, so a sub-view rendered this way came out as dark text on
 * black. Every sub-view container below sets bg-white explicitly for the same
 * reason -- don't remove it because it looks redundant.
 */
export function SettingsSubHeader({
  title,
  icon,
  onBack,
}: {
  title: string;
  /** Should be the same glyph as the row that pushed this view -- the icon is
   *  what makes the transition read as "this row opened", rather than as an
   *  unrelated screen that happens to share a word. */
  icon?: React.ComponentType<any>;
  onBack: () => void;
}) {
  return (
    <View className="flex-row items-center px-5 py-4 border-b border-border bg-background">
      <Pressable onPress={onBack} className="p-1 -ml-1 mr-2 active:opacity-60">
        <Icon as={ChevronRight} className="text-foreground w-5 h-5 rotate-180" />
      </Pressable>
      {icon ? <Icon as={icon} className="w-5 h-5 mr-2 text-muted-foreground" /> : null}
      <RNText className="text-base font-semibold text-foreground">{title}</RNText>
    </View>
  );
}

/** Header for a top-level settings sheet: icon, title, and a close control. */
export function SettingsHeader({
  title,
  icon,
  right,
}: {
  title: string;
  icon?: React.ComponentType<any>;
  right?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between px-5 py-4 bg-background">
      <View className="flex-row items-center">
        {icon ? <Icon as={icon} className="w-5 h-5 mr-2 text-muted-foreground" /> : null}
        <RNText className="text-base font-semibold text-foreground">{title}</RNText>
      </View>
      {right}
    </View>
  );
}
