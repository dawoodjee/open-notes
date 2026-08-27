import * as SecureStore from '@/lib/crypto/secureStorage';
import {
  APPEARANCE_KEY,
  APP_THEME_KEY,
  BULLET_STYLE_KEY,
  readSetting,
  writeSetting,
} from './syncedSettings';
import { resolveSetting } from './resolveSetting';

/**
 * Appearance, app theme and bullet style, as account settings rather than
 * device ones (Stage 13c).
 *
 * ── WHY THESE NEED THE SAME MIRROR TRICK AS THE LOCK ──────────────────────
 *
 * `ThemeContext` reads them before the encrypted database exists -- the boot
 * spinner, the lock screen and the boot-failure screen all paint while
 * PowerSync is not open, and the appearance has to be settled first or a
 * dark-mode launch flashes white. That is the identical constraint the lock
 * settings have, so it gets the identical answer: the synced table is the
 * source of truth, and `secureStorage` holds what boot reads.
 *
 * ── THE LEGACY KEYS, WHICH ARE NOT THE NEW ONES ───────────────────────────
 *
 * These have been stored since Stage 9 under `notes.appearance.v1`,
 * `notes.theme.v1` and `notes.bulletStyle.v1`, as BARE STRINGS. The synced
 * mirror namespaces its keys (`notes.settings.` + key) and JSON-encodes values,
 * so the new mirror entry is a different key holding a differently-shaped
 * value. Reading the old key when the new one is empty is what stops every
 * existing device silently reverting to system/flat/dash on upgrade.
 *
 * Note `bulletStyle` -> `bulletstyle.v1`: the migration constrains keys to
 * lowercase, and a camelCase key would be accepted locally and rejected on
 * upload, where the failure jams the sync queue rather than surfacing.
 */

const LEGACY_APPEARANCE = 'notes.appearance.v1';
const LEGACY_APP_THEME = 'notes.theme.v1';
const LEGACY_BULLET_STYLE = 'notes.bulletStyle.v1';

/**
 * Mirror first, then the pre-13c key, then the default.
 *
 * `validate` rather than a bare cast: a value can arrive from another device
 * running a different build, and a theme this binary cannot paint would render
 * nothing and look like a bug. Same check `ThemeContext` already applied to its
 * own stored value -- kept, and now applied to the synced one too.
 */
async function read<T extends string>(
  key: string,
  legacyKey: string,
  validate: (value: string) => value is T,
  fallback: T
): Promise<T> {
  const synced = await readSetting<string | null>(key, null);
  const legacy = await SecureStore.getItemAsync(legacyKey);
  // The precedence itself is pure and tested -- see resolveSetting.ts for why
  // it had to be extracted rather than checked by launching the app.
  return resolveSetting(typeof synced === 'string' ? synced : null, legacy, validate, fallback);
}

export type Appearance = 'light' | 'dark' | 'system';
export type BulletStyle = 'dash' | 'dot';

const isAppearance = (v: string): v is Appearance =>
  v === 'light' || v === 'dark' || v === 'system';
const isBulletStyle = (v: string): v is BulletStyle => v === 'dash' || v === 'dot';

export function getAppearance(): Promise<Appearance> {
  return read(APPEARANCE_KEY, LEGACY_APPEARANCE, isAppearance, 'system');
}

export function setAppearance(value: Appearance): Promise<void> {
  return writeSetting(APPEARANCE_KEY, value);
}

export function getBulletStyle(): Promise<BulletStyle> {
  return read(BULLET_STYLE_KEY, LEGACY_BULLET_STYLE, isBulletStyle, 'dash');
}

export function setBulletStyle(value: BulletStyle): Promise<void> {
  return writeSetting(BULLET_STYLE_KEY, value);
}

/**
 * The theme is validated against the caller's catalogue rather than a union,
 * because "available" is a property of THIS BUILD. A device that stored a theme
 * before it shipped, or one syncing from a newer client, must not leave the app
 * pointing at something it cannot paint.
 */
export async function getAppTheme(isKnown: (value: string) => boolean): Promise<string | null> {
  const validate = (v: string): v is string => isKnown(v);
  const found = await read(APP_THEME_KEY, LEGACY_APP_THEME, validate, '');
  return found === '' ? null : found;
}

export function setAppTheme(value: string): Promise<void> {
  return writeSetting(APP_THEME_KEY, value);
}
