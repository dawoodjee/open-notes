import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';
import { Check, Download, FolderInput, Upload, UserX } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSegmented,
  SettingsSubHeader,
  SettingsToggle,
} from '@/components/ui/settings-group';
import { DataJobStatus } from './DataJobStatus';
import { useJobState } from '@/lib/dataio/dataJobs';
import { startExport } from '@/lib/dataio/exportNotes';
import { IMPORTED_FOLDER_NAME, startImport, type ImportOptions } from '@/lib/dataio/importNotes';
import type { ExportScope } from '@/lib/dataio/archiveLayout';
import { listFolders } from '@/lib/powersync/folders';
import { requestAccountDeletion } from '@/lib/account/deletion';
import { useAuth } from '@/contexts/AuthContext';
import type { Folder } from '@/types/folder';

/**
 * Settings -> Data, and its Export and Import pages (Stage 15).
 *
 * Built from the existing Settings pieces rather than new ones, per the Stage
 * 15 prompt: the same sub-page shell, and both toggles are `SettingsSegmented`
 * inside a `SettingsRow` -- exactly how Security -> Lock Time is drawn.
 */

export function DataView({
  onBack,
  onExport,
  onImport,
  onDeleteAccount,
}: {
  onBack: () => void;
  onExport: () => void;
  onImport: () => void;
  onDeleteAccount: () => void;
}) {
  // Deleting an ACCOUNT needs one. A signed-out device's notes are local only,
  // and erasing those is what sign-out already does.
  const { session } = useAuth();
  return (
    <>
      <SettingsSubHeader title="Data" onBack={onBack} />
      <ScrollView className="flex-1 px-5 pt-4 bg-background">
        <DataJobStatus />
        <SettingsGroup footnote="Your notes are decrypted on this device to do either of these. Nothing is sent anywhere to make or read the file.">
          <SettingsRow
            icon={Upload}
            label="Export"
            sublabel="Save your notes as a .zip of Markdown files"
            onPress={onExport}
          />
          <SettingsRow
            icon={Download}
            label="Import"
            sublabel="Bring notes in from a .zip of Markdown files"
            onPress={onImport}
          />
        </SettingsGroup>
        {session ? (
          <SettingsGroup footnote="Erases this account and everything in it after 30 days. You can cancel until then.">
            <SettingsRow icon={UserX} label="Delete account" destructive onPress={onDeleteAccount} />
          </SettingsGroup>
        ) : null}
        <View className="h-8" />
      </ScrollView>
    </>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────

type Chosen = 'allNotes' | string; // a folder id

export function ExportView({ onBack }: { onBack: () => void }) {
  const job = useJobState();
  const busy = job.status === 'running';
  const [mode, setMode] = useState<'everything' | 'choose'>('everything');
  // "Choose" defaults to All Notes (Stage 15 prompt).
  const [chosen, setChosen] = useState<Chosen>('allNotes');
  const folders = useFolderList();

  const scope: ExportScope =
    mode === 'everything'
      ? { kind: 'everything' }
      : chosen === 'allNotes'
        ? { kind: 'allNotes' }
        : { kind: 'folder', folderId: chosen };

  return (
    <>
      <SettingsSubHeader title="Export" onBack={onBack} />
      <ScrollView className="flex-1 px-5 pt-4 bg-background">
        <RNText className="text-base text-muted-foreground mb-2 px-1">
          Makes a .zip of your notes as Markdown files, in folders that mirror yours. Markdown opens in
          almost any notes app or text editor.
        </RNText>
        {/*
          The one place this app hands out plaintext on purpose. Everywhere else
          a note is ciphertext except on your own screen; an export is readable
          by whoever holds the file. Said before the button, not after.
        */}
        <RNText className="text-base text-foreground mb-6 px-1">
          The zip is not encrypted — anyone who has the file can read what’s in it. Keep it somewhere safe.
        </RNText>

        <DataJobStatus only="export" />

        <SettingsGroup
          footnote={
            mode === 'everything'
              ? 'Every note, including Recently Deleted — those go in a folder of their own inside the zip. Exporting a deleted note doesn’t restore it.'
              : 'A folder exports with everything inside it. All Notes is what the All Notes list shows.'
          }
        >
          <SettingsRow
            label="Notes"
            right={
              <SettingsSegmented
                options={[
                  { label: 'Everything', value: 'everything' },
                  { label: 'Choose', value: 'choose' },
                ]}
                value={mode}
                onChange={setMode}
                disabled={busy}
              />
            }
          />
        </SettingsGroup>

        {mode === 'choose' ? (
          <SettingsGroup caption="Export from">
            <SettingsRow
              label="All Notes"
              onPress={busy ? undefined : () => setChosen('allNotes')}
              right={chosen === 'allNotes' ? <Selected /> : undefined}
            />
            {folders.map((f) => (
              <SettingsRow
                key={f.id}
                // Indented by depth so the tree reads as a tree.
                label={`${'    '.repeat(f.depth)}${f.name}`}
                onPress={busy ? undefined : () => setChosen(f.id)}
                right={chosen === f.id ? <Selected /> : undefined}
              />
            ))}
          </SettingsGroup>
        ) : null}

        <PrimaryButton label="Export" busy={busy} onPress={() => void startExport(scope)} />
        <View className="h-8" />
      </ScrollView>
    </>
  );
}

// ─── Import ───────────────────────────────────────────────────────────────

export function ImportView({ onBack }: { onBack: () => void }) {
  const job = useJobState();
  const busy = job.status === 'running';
  // Defaults from the Stage 15 prompt: land at the top level, never overwrite.
  const [placement, setPlacement] = useState<ImportOptions['placement']>('allNotes');
  const [overwrite, setOverwrite] = useState(false);

  return (
    <>
      <SettingsSubHeader title="Import" onBack={onBack} />
      <ScrollView className="flex-1 px-5 pt-4 bg-background">
        <RNText className="text-base text-muted-foreground mb-6 px-1">
          Reads notes back in from a .zip of Markdown files — an export from this app, or from another
          notes app. Folders in the zip become folders here.
        </RNText>

        <DataJobStatus only="import" />

        <SettingsGroup
          footnote={
            placement === 'allNotes'
              ? 'The zip’s folders sit alongside yours. A folder with the same name is filled, not duplicated.'
              : `Everything goes inside one “${IMPORTED_FOLDER_NAME}” folder, reused by every import.`
          }
        >
          <SettingsRow
            icon={FolderInput}
            label="Put notes in"
            right={
              <SettingsSegmented
                options={[
                  { label: 'All Notes', value: 'allNotes' },
                  { label: IMPORTED_FOLDER_NAME, value: 'imported' },
                ]}
                value={placement}
                onChange={setPlacement}
                disabled={busy}
              />
            }
          />
        </SettingsGroup>

        <SettingsGroup
          footnote={
            overwrite
              ? 'A note with the same title but different content is REPLACED by the one in the zip. This can’t be undone.'
              : 'A note with the same title keeps both copies if they differ, and is skipped if they’re identical.'
          }
        >
          <SettingsRow
            label="Overwrite same-titled notes"
            right={<SettingsToggle value={overwrite} onChange={setOverwrite} disabled={busy} />}
          />
        </SettingsGroup>

        <PrimaryButton label="Choose a .zip…" busy={busy} onPress={() => void startImport({ placement, overwrite })} />
        <View className="h-8" />
      </ScrollView>
    </>
  );
}

// ─── Delete account (Stage 15b) ───────────────────────────────────────────

/**
 * Decided (Decisions Log, 2026-09-28): a 30-day grace period, and the
 * confirmation is typing DELETE -- nothing more. The grace period is what
 * covers the weaker confirmation: a deletion started by someone holding an
 * unlocked phone can be cancelled by signing in within the 30 days.
 *
 * Everything a person needs to decide is on this page BEFORE the button, and
 * the first thing offered is a copy of their notes.
 */
export function DeleteAccountView({
  onBack,
  onExport,
  onRequested,
}: {
  onBack: () => void;
  onExport: () => void;
  /**
   * Close Settings once the request succeeds. Not optional in effect: the
   * suspended screen is part of the app, and Settings is a sheet ABOVE the app
   * -- portalled to the top of the page on web, a separate native layer on iOS.
   * Left open, it hid the suspended screen entirely, so the person who had
   * just deleted their account was still looking at the Delete page. Found in
   * the dev-stack run by checking which element was topmost.
   */
  onRequested: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const armed = typed.trim() === 'DELETE';

  const submit = async () => {
    if (!armed || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      // On success this device suspends at once and AccountSuspendedOverlay
      // replaces the app -- but only once Settings, which sits above the app,
      // is out of the way. See onRequested.
      await requestAccountDeletion();
      onRequested();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'The request did not go through.');
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsSubHeader title="Delete account" onBack={onBack} />
      <ScrollView className="flex-1 px-5 pt-4 bg-background" keyboardShouldPersistTaps="handled">
        <View className="gap-3 mb-6 px-1">
          <RNText className="text-base text-foreground">
            Deleting your account erases every note, folder and setting in it — from our servers and from
            every device you use.
          </RNText>
          <RNText className="text-base text-muted-foreground">
            It happens after 30 days. Until then every device stops syncing and keeps its notes, still
            encrypted, and you can cancel from any of them to get everything back.
          </RNText>
          <RNText className="text-base text-muted-foreground">
            After 30 days it can’t be undone.
          </RNText>
        </View>

        <SettingsGroup footnote="A .zip of Markdown files you keep, whatever happens to the account.">
          <SettingsRow icon={Upload} label="Export your notes first" onPress={onExport} />
        </SettingsGroup>

        <RNText className="text-sm text-muted-foreground mb-2 px-1">Type DELETE to confirm</RNText>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          editable={!busy}
          placeholder="DELETE"
          accessibilityLabel="Type DELETE to confirm"
          className="rounded-2xl bg-secondary px-4 py-3 text-base text-foreground mb-4"
          style={{ outlineStyle: 'none' } as any}
          onSubmitEditing={() => void submit()}
        />

        {message ? (
          <RNText className="text-base text-red-600 dark:text-red-400 mb-4 px-1">{message}</RNText>
        ) : null}

        <Pressable
          onPress={() => void submit()}
          disabled={!armed || busy}
          className={`px-6 py-3 rounded-full items-center ${armed && !busy ? 'bg-red-600' : 'bg-foreground/10'}`}
          accessibilityRole="button"
          accessibilityLabel="Delete account"
          accessibilityState={{ disabled: !armed || busy, busy }}
        >
          <RNText className={`text-base font-medium ${armed && !busy ? 'text-white' : 'text-muted-foreground'}`}>
            {busy ? 'Working…' : 'Delete account'}
          </RNText>
        </Pressable>
        <View className="h-8" />
      </ScrollView>
    </>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────

function Selected() {
  return <Icon as={Check} className="w-5 h-5 text-lime-600 dark:text-lime-400" />;
}

function PrimaryButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className={`mt-2 px-6 py-3 rounded-full items-center ${busy ? 'bg-foreground/10' : 'bg-lime-500'}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
    >
      <RNText className={`text-base font-medium ${busy ? 'text-muted-foreground' : 'text-on-accent'}`}>
        {busy ? 'Working…' : label}
      </RNText>
    </Pressable>
  );
}

/**
 * Enabled, readable folders in sidebar order: each parent followed by its
 * children. Read once when the page opens -- the Export page is short-lived,
 * and a folder created while it is open is not something it needs to chase.
 */
function useFolderList(): Folder[] {
  const [folders, setFolders] = useState<Folder[]>([]);
  useEffect(() => {
    let alive = true;
    void listFolders().then((all) => alive && setFolders(all));
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => {
    const usable = folders.filter((f) => f.isEnabled && !f.decryptFailed);
    const byParent = new Map<string | null, Folder[]>();
    for (const f of usable) byParent.set(f.parentId, [...(byParent.get(f.parentId) ?? []), f]);
    const ordered: Folder[] = [];
    const walk = (parent: string | null) => {
      for (const f of byParent.get(parent) ?? []) {
        ordered.push(f);
        walk(f.id);
      }
    };
    walk(null);
    return ordered;
  }, [folders]);
}
