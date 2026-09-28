/**
 * The setting keys, and the pre-13c SecureStore key each one replaced.
 *
 * A pure module with no react-native imports, for the same reason
 * `settingRowId.ts` is one: the test harness runs under plain Node, and
 * `syncedSettings.ts` reaches react-native through `secureStorage`. Anything
 * that has to be tested has to live outside that import chain.
 *
 * That is not a technicality here. The legacy map's failure mode is SILENT --
 * a preference that reads correctly on its own device and never syncs, forever
 * -- which is exactly what happened on Adam's simulators: the phone showed
 * dark, the tablet showed light, and the settings table stayed empty because
 * adoption only looked at the mirror. A missing entry in this map reproduces
 * that bug per-setting with no error anywhere.
 */

/**
 * ALL LOWERCASE, and that is not a style preference -- the migration constrains
 * keys to `^[a-z0-9]+(\.[a-z0-9]+)*$`. A camelCase key like `bulletStyle.v1`
 * type-checks, writes to the mirror happily, and is then REJECTED by Postgres
 * on upload, where a constraint violation is not classified as structural and
 * so retries forever, jamming every operation queued behind it.
 */
export const LOCK_SETTINGS_KEY = 'lock.v1';
export const APPEARANCE_KEY = 'appearance.v1';
export const APP_THEME_KEY = 'theme.v1';
export const BULLET_STYLE_KEY = 'bulletstyle.v1';

/** Every key this app syncs. Used to push local choices up at first sign-in. */
export const ALL_SETTING_KEYS = [
  LOCK_SETTINGS_KEY,
  APPEARANCE_KEY,
  APP_THEME_KEY,
  BULLET_STYLE_KEY,
];

/**
 * Where each setting lived before Stage 13c, for the settings that existed then.
 *
 * `lock.v1` is deliberately absent: the lock has never had a standalone
 * SecureStore key -- it was a field inside the vault blob -- so there is
 * nothing to adopt from, and inventing an entry would make adoption look for a
 * key that never existed.
 *
 * NOTE the value shape differs. These hold BARE strings (`dark`); the mirror
 * and the table hold JSON (`"dark"`). Adoption has to encode across that gap.
 */
export const LEGACY_KEY: Record<string, string> = {
  [APPEARANCE_KEY]: 'notes.appearance.v1',
  [APP_THEME_KEY]: 'notes.theme.v1',
  [BULLET_STYLE_KEY]: 'notes.bulletStyle.v1',
};
