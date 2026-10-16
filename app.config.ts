import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json is the configuration; this only adds the web app's base path.
 *
 * `WEB_BASE_URL` (e.g. `/web`) is set when building the web app for a host that
 * serves it under a sub-path -- see lib/pwa/basePath.ts. Unset, nothing here
 * changes: development, native builds and a self-hoster serving the web app at
 * the root all get app.json exactly as written.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = process.env.WEB_BASE_URL?.trim();
  if (!base) return config as ExpoConfig;
  return {
    ...config,
    experiments: { ...config.experiments, baseUrl: base },
  } as ExpoConfig;
};
