/**
 * Getting a zip out to the user and in from them -- web.
 *
 * No dependencies: a Blob plus a temporary <a download> is how a browser saves
 * a file, and an <input type="file"> is how it picks one. See fileIO.ts for why
 * native needs the share sheet instead, and for the "no network" property,
 * which holds here too -- the Blob URL is local to this tab.
 */

export type SaveOutcome = 'shared' | 'downloaded' | 'unavailable';

export async function saveZip(bytes: Uint8Array, fileName: string): Promise<SaveOutcome> {
  if (typeof document === 'undefined') return 'unavailable';

  // A copy, because a Uint8Array can be a view into a larger buffer and Blob
  // would then write the whole buffer, not just this slice.
  const blob = new Blob([bytes.slice()], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked late, not immediately: some browsers read the URL asynchronously
  // after click() returns, and revoking first cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export interface PickedZip {
  name: string;
  bytes: Uint8Array;
}

export function pickZip(): Promise<PickedZip | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip,application/x-zip-compressed';
    input.style.display = 'none';

    let settled = false;
    const finish = (value: PickedZip | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      finish({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    });
    // Fired when the user dismisses the dialog. Without it the promise would
    // never settle, and the Import button would stay busy forever.
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}
