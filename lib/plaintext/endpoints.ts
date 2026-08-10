// expo-crypto, not the global `crypto`. react-native-get-random-values
// polyfills crypto.getRandomValues and nothing else, so crypto.randomUUID is
// undefined under Hermes -- verified the hard way, as a silent promise
// rejection that simply failed to add a row. Every other id in this codebase
// comes from here (see lib/powersync/db.ts).
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { getPowerSync } from '@/lib/powersync/db';

/**
 * The allow-list of places this device may send decrypted note text.
 *
 * WHY AN ALLOW-LIST AT ALL, given there are already two on/off gates: a gate
 * says "this feature may send plaintext", not "plaintext may go anywhere".
 * Without a registry, `destination` would be a free-form string supplied by
 * whatever code called the broker, and the user's toggle would be authorising
 * an unbounded set of hosts. Making the destination a foreign key into a list
 * the user typed by hand is what keeps the toggle's meaning bounded.
 *
 * STORAGE IS SPLIT ON PURPOSE:
 *   metadata -> api_endpoints, a localOnly table inside the SQLCipher database
 *   token    -> one SecureStore item each, keyed by endpoint id
 *
 * Not tidiness. SecureStore caps a value at roughly 2KB, and a list of tokens
 * in a single item grows without bound -- exactly the cap that already forced
 * the LargeSecureStore workaround in lib/supabase/client.ts. One item per
 * token also means deleting an endpoint can delete its secret outright rather
 * than rewriting a blob.
 */

export type EndpointUse = 'ai' | 'api';

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  use: EndpointUse;
  confirmedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const tokenKey = (id: string) => `notes.endpoint.${id}.token`;

const TOKEN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function toEndpoint(row: any): Endpoint {
  return {
    id: row.id,
    name: row.name ?? '',
    url: row.url ?? '',
    use: (row.use as EndpointUse) ?? 'api',
    confirmedAt: row.confirmed_at ?? null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}

export async function listEndpoints(): Promise<Endpoint[]> {
  const rows = await getPowerSync().getAll<any>(
    'SELECT id, name, url, use, confirmed_at, created_at, last_used_at FROM api_endpoints ORDER BY created_at'
  );
  return rows.map(toEndpoint);
}

export async function getEndpoint(id: string): Promise<Endpoint | null> {
  const row = await getPowerSync().getOptional<any>(
    'SELECT id, name, url, use, confirmed_at, created_at, last_used_at FROM api_endpoints WHERE id = ?',
    [id]
  );
  return row ? toEndpoint(row) : null;
}

export async function createEndpoint(use: EndpointUse): Promise<Endpoint> {
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await getPowerSync().execute(
    `INSERT INTO api_endpoints (id, name, url, use, confirmed_at, created_at, last_used_at)
     VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
    [id, '', '', use, now]
  );
  return { id, name: '', url: '', use, confirmedAt: null, createdAt: now, lastUsedAt: null };
}

/**
 * Editing the URL clears the consent. The user approved sending plaintext to
 * a specific host, not to whatever that row is later pointed at -- otherwise
 * "approve a harmless endpoint, then repoint it" is a consent bypass with no
 * prompt.
 */
export async function updateEndpoint(
  id: string,
  changes: { name?: string; url?: string; use?: EndpointUse }
): Promise<void> {
  const existing = await getEndpoint(id);
  if (!existing) return;

  const url = changes.url ?? existing.url;
  const confirmedAt = url !== existing.url ? null : existing.confirmedAt;

  await getPowerSync().execute(
    'UPDATE api_endpoints SET name = ?, url = ?, use = ?, confirmed_at = ? WHERE id = ?',
    [changes.name ?? existing.name, url, changes.use ?? existing.use, confirmedAt, id]
  );
}

export async function markEndpointConfirmed(id: string): Promise<void> {
  await getPowerSync().execute('UPDATE api_endpoints SET confirmed_at = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);
}

export async function markEndpointUsed(id: string): Promise<void> {
  await getPowerSync().execute('UPDATE api_endpoints SET last_used_at = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);
}

/** Removes the row and its token together. Leaving an orphaned token in the
 *  keychain would be a live credential for a destination the user deleted. */
export async function deleteEndpoint(id: string): Promise<void> {
  await getPowerSync().execute('DELETE FROM api_endpoints WHERE id = ?', [id]);
  await SecureStore.deleteItemAsync(tokenKey(id), TOKEN_OPTIONS);
}

export async function setEndpointToken(id: string, token: string): Promise<void> {
  if (token) {
    await SecureStore.setItemAsync(tokenKey(id), token, TOKEN_OPTIONS);
  } else {
    await SecureStore.deleteItemAsync(tokenKey(id), TOKEN_OPTIONS);
  }
}

export async function getEndpointToken(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(id), TOKEN_OPTIONS);
}

/**
 * What the settings list shows: enough to recognise the token, never enough to
 * use it. The full value is only ever read by the broker, at the moment of a
 * request.
 */
export function maskToken(token: string | null): string {
  if (!token) return '—';
  return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`;
}
