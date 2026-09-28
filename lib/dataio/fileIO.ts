import type * as FileSystemModule from 'expo-file-system';
import type * as DocumentPickerModule from 'expo-document-picker';
import type * as SharingModule from 'expo-sharing';

/**
 * Getting a zip OUT to the user and IN from them -- native.
 *
 * The web version (fileIO.web.ts) shares nothing with this but the signatures:
 * a browser downloads a Blob and reads an <input type="file">, while a phone
 * has no "downloads folder" an app can simply write into. On iOS and Android
 * the honest route is the share sheet, which is also the better one -- it
 * offers Save to Files, AirDrop, Mail and Drive in one place, so this app never
 * has to pick a destination on the user's behalf.
 *
 * Everything here moves bytes that are ALREADY decrypted, on this device. Not
 * one call goes to the network: the zip is built in memory, written to this
 * app's own cache directory, and handed to the OS.
 */

export type SaveOutcome = 'shared' | 'downloaded' | 'unavailable';

/**
 * The three native modules, loaded on first use -- NOT imported at the top.
 *
 * Same trap as `react-native-pulsar` in Stage 12 (see lib/theme/haptics.ts):
 * a native module missing from the running binary throws at IMPORT, before any
 * code here runs, so a try/catch at the call site cannot reach it. This file is
 * imported by Settings, which loads at startup -- so a static import would turn
 * "this build predates Stage 15" into "the app crashes on launch". Any binary
 * built before these modules were added (an Android build not yet rebuilt, an
 * older TestFlight) must degrade to "export unavailable", not fail to open.
 */
interface NativeFileModules {
  fs: typeof FileSystemModule;
  picker: typeof DocumentPickerModule;
  sharing: typeof SharingModule;
}
let modules: NativeFileModules | null | undefined;

function native(): NativeFileModules | null {
  if (modules !== undefined) return modules;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    modules = {
      fs: require('expo-file-system'),
      picker: require('expo-document-picker'),
      sharing: require('expo-sharing'),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    modules = null;
  }
  return modules;
}

/** Thrown to the job, which turns it into a readable "didn't finish". */
const NOT_IN_THIS_BUILD = 'this version of the app does not include file access yet — update it and try again';

export async function saveZip(bytes: Uint8Array, fileName: string): Promise<SaveOutcome> {
  const mods = native();
  if (!mods || !(await mods.sharing.isAvailableAsync())) return 'unavailable';
  const { File, Paths } = mods.fs;

  // The cache directory, not documents: the OS may clear it, which is exactly
  // right for a file whose only job is to be handed to the share sheet.
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(bytes);

  try {
    await mods.sharing.shareAsync(file.uri, {
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
      dialogTitle: 'Export notes',
    });
  } finally {
    // A decrypted copy of every note, sitting in a file, is the one thing this
    // feature must not leave behind. The share sheet has finished with it --
    // whatever it copied, it copied -- so it goes now rather than whenever the
    // OS next clears the cache.
    try {
      if (file.exists) file.delete();
    } catch {
      // Best effort; the OS clears caches regardless.
    }
  }
  return 'shared';
}

export interface PickedZip {
  name: string;
  bytes: Uint8Array;
}

export async function pickZip(): Promise<PickedZip | null> {
  const mods = native();
  if (!mods) throw new Error(NOT_IN_THIS_BUILD);
  const { File } = mods.fs;

  const result = await mods.picker.getDocumentAsync({
    // Android reports zips under both names depending on where they came from.
    type: ['application/zip', 'application/x-zip-compressed'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const file = new File(asset.uri);
  try {
    return { name: asset.name, bytes: await file.bytes() };
  } finally {
    // The picker's cached copy -- same reasoning as the export file above.
    try {
      if (file.exists) file.delete();
    } catch {
      // Best effort.
    }
  }
}
