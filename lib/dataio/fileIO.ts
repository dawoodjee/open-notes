import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

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

export async function saveZip(bytes: Uint8Array, fileName: string): Promise<SaveOutcome> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';

  // The cache directory, not documents: the OS may clear it, which is exactly
  // right for a file whose only job is to be handed to the share sheet.
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(bytes);

  try {
    await Sharing.shareAsync(file.uri, {
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
  const result = await DocumentPicker.getDocumentAsync({
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
