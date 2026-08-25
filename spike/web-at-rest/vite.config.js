import { defineConfig } from 'vite';

// OPFS-backed VFS variants run inside workers and want cross-origin isolation.
// Setting COOP/COEP here is what lets OPFSCoopSyncVFS work in the dev server;
// without it the OPFS path silently falls back or fails to start.
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  // wa-sqlite ships .wasm + worker .mjs files that Vite's dep optimizer mangles.
  optimizeDeps: {
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web']
  },
  worker: { format: 'es' }
});
