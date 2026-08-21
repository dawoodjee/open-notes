import React from 'react';
import { Text as RNText, TextInput, View } from 'react-native';
import { PressableScale } from './PressableScale';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Confirmation for deleting a folder that isn't empty.
 *
 * Only ever rendered when there is something to lose -- an empty folder is
 * deleted silently, per the reference behaviour. A confirmation for a folder
 * with nothing in it is the kind of prompt that teaches people to dismiss
 * prompts without reading them.
 *
 * The wording is the reference screenshot's, and the second line is the part
 * that matters: it says subfolders will go too, which is the consequence a
 * user cannot see from the row they long-pressed. What it deliberately does
 * NOT say is that the notes are destroyed, because they are not -- they land
 * in Recently Deleted. Overstating the damage would be its own kind of lie.
 *
 * Side-by-side buttons with Delete on the right, matching the screenshots.
 * Cancel is the visually heavier of the two on purpose: the safe choice should
 * not be the one you have to aim for.
 */
export function DeleteFolderDialog({
  folderName,
  noteCount,
  subfolderCount,
  onCancel,
  onConfirm,
}: {
  folderName: string;
  noteCount: number;
  subfolderCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <View className="absolute inset-0 items-center justify-center px-8 bg-black/40">
      <View className="w-full max-w-sm rounded-2xl bg-background p-6">
        <RNText className="text-lg font-semibold text-foreground mb-2">
          Delete Folder?
        </RNText>
        <RNText className="text-sm text-muted-foreground mb-1">
          All notes and any subfolders will be deleted.
        </RNText>
        {/* The abstract warning above is the screenshot's. This line says what
            it means for THIS folder, which is the thing the user is actually
            deciding about. */}
        <RNText className="text-sm text-muted-foreground mb-5">
          “{folderName}” holds {noteCount} {noteCount === 1 ? 'note' : 'notes'}
          {subfolderCount > 0
            ? ` and ${subfolderCount} ${subfolderCount === 1 ? 'subfolder' : 'subfolders'}`
            : ''}
          . {noteCount === 1 ? 'It moves' : 'They move'} to Recently Deleted, not gone for good.
        </RNText>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <PressableScale
            onPress={onCancel}
            containerStyle={{ flex: 1 }}
            style={{ minHeight: 48 }}
            className="rounded-2xl items-center justify-center bg-secondary"
            accessibilityRole="button"
          >
            <RNText className="text-foreground font-medium">Cancel</RNText>
          </PressableScale>
          <PressableScale
            onPress={onConfirm}
            containerStyle={{ flex: 1 }}
            style={{ minHeight: 48 }}
            className="rounded-2xl items-center justify-center bg-secondary"
            accessibilityRole="button"
          >
            <RNText className="text-destructive font-semibold">Delete</RNText>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

/**
 * Naming a folder, on create and on rename.
 *
 * One component for both because they are the same interaction with a
 * different starting value, and splitting them is how the two drift into
 * having different keyboard behaviour.
 */
export function FolderNameDialog({
  title,
  initialValue,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  initialValue: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  const trimmed = value.trim();

  return (
    <View className="absolute inset-0 items-center justify-center px-8 bg-black/40">
      <View className="w-full max-w-sm rounded-2xl bg-background p-6">
        <RNText className="text-lg font-semibold text-foreground mb-4">{title}</RNText>

        <NameField value={value} onChangeText={setValue} onSubmit={() => trimmed && onConfirm(trimmed)} />

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
          <PressableScale
            onPress={onCancel}
            containerStyle={{ flex: 1 }}
            style={{ minHeight: 48 }}
            className="rounded-2xl items-center justify-center bg-secondary"
            accessibilityRole="button"
          >
            <RNText className="text-foreground font-medium">Cancel</RNText>
          </PressableScale>
          <PressableScale
            onPress={() => trimmed && onConfirm(trimmed)}
            disabled={!trimmed}
            containerStyle={{ flex: 1, opacity: trimmed ? 1 : 0.5 }}
            style={{ minHeight: 48 }}
            className="rounded-2xl items-center justify-center bg-primary"
            accessibilityRole="button"
          >
            <RNText className="text-primary-foreground font-semibold">{confirmLabel}</RNText>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

/** The --muted-foreground token, for the one prop that cannot take a class.
 *  Kept in step with global.css by hand, same as BACKGROUND in ThemeContext --
 *  placeholderTextColor is a colour prop, so `text-muted-foreground` cannot
 *  reach it. Both values are the token's, not new shades. */
const PLACEHOLDER = { light: 'rgb(115 115 115)', dark: 'rgb(161 161 166)' } as const;

function NameField({
  value,
  onChangeText,
  onSubmit,
}: {
  value: string;
  onChangeText: (next: string) => void;
  onSubmit: () => void;
}) {
  const { scheme } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
      placeholder="Folder name"
      className="rounded-xl bg-secondary px-4 text-base text-foreground"
      style={{ minHeight: 48 }}
      placeholderTextColor={PLACEHOLDER[scheme]}
    />
  );
}
