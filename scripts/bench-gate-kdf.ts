/**
 * How long one passcode attempt costs, and therefore how long a full sweep of
 * the 10^6 keyspace costs an attacker.
 *
 * Run: npx tsx scripts/bench-gate-kdf.ts
 *
 * WHY THIS IS A SCRIPT AND NOT A BROWSER MEASUREMENT. The number that matters
 * is a browser number, and the browser could not give an honest one: an
 * automated pane reports `document.visibilityState === 'hidden'`, which clamps
 * setTimeout to 1s and pauses requestAnimationFrame entirely, so every
 * wall-clock reading came back pinned near 6000ms regardless of the parameters.
 * The first retune was very nearly made on that garbage.
 *
 * Node runs the identical pure-JS @noble implementation on the same V8, so this
 * is a fair proxy for the cost in a foreground tab. Treat it as the order of
 * magnitude, not the millisecond.
 */
import { scrypt } from '@noble/hashes/scrypt.js';
import { utf8ToBytes } from '@noble/ciphers/utils.js';
import { GATE_KDF_PARAMS } from '../lib/crypto/gateKey';

const salt = new Uint8Array(16).fill(7);

function timeOne(N: number): number {
  scrypt(utf8ToBytes('warmup'), salt, { N, r: 8, p: 1, dkLen: 32 });
  const runs = N >= 65536 ? 2 : 5;
  const started = performance.now();
  for (let i = 0; i < runs; i++) {
    scrypt(utf8ToBytes('13579' + i), salt, { N, r: 8, p: 1, dkLen: 32 });
  }
  return (performance.now() - started) / runs;
}

console.log(`shipping N = 2^${Math.log2(GATE_KDF_PARAMS.N)} (r=${GATE_KDF_PARAMS.r})\n`);
for (const N of [4096, 8192, 16384, 32768, 65536]) {
  const ms = timeOne(N);
  const days = (ms * 1e6) / 1000 / 60 / 60 / 24;
  const mark = N === GATE_KDF_PARAMS.N ? '  <-- shipping' : '';
  console.log(
    `N=2^${String(Math.log2(N)).padStart(2)}  ${ms.toFixed(0).padStart(5)} ms/attempt` +
      `   10^6 sweep: ${days.toFixed(1).padStart(6)} days${mark}`
  );
}
