/**
 * Task #65: a failed sign-in must not wedge every later sign-in.
 *
 * SCOPE. This exercises lib/auth/serializeAuthWork.ts for real -- that module
 * is deliberately dependency-free (no React, no react-native, no
 * expo-secure-store, no PowerSync) precisely so the guard that
 * contexts/AuthContext.tsx actually runs can be executed under plain Node
 * rather than re-implemented here. What is NOT covered is the work being
 * serialized: reconcileAccountKey, claimAndConnect and the session setters are
 * device-side and get verified on device.
 *
 * Case 2 is the regression test for the reported bug: sign-in #1 fails, and
 * sign-in #2 -- with no app relaunch -- has to run anyway.
 *
 * Run: npx tsx scripts/verify-auth-serialization.ts
 */
import { isIdle, resetForTests, runSerialized } from '../lib/auth/serializeAuthWork';

let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 10));

/**
 * The waiter in AuthContext is `void handleAuthEvent(...)` -- fire-and-forget.
 * A rejection there is unhandled, and under Node an unhandled rejection kills
 * the process, which would make a failing case look like a crashed script
 * rather than a FAIL line. Swallowing it here keeps the output readable; the
 * assertions below are what decide pass/fail.
 */
process.on('unhandledRejection', () => {});

async function main() {
  // ---------------------------------------------------------------- case 1
  // The failure still reaches the caller, and the guard is released anyway.
  resetForTests();
  const boom = new Error('reconcileAccountKey exploded');
  let seen: unknown;
  try {
    await runSerialized(async () => {
      await tick();
      throw boom;
    });
  } catch (err) {
    seen = err;
  }
  check('1a. the original error still propagates to its own caller', seen === boom, String(seen));
  check('1b. the guard is released after a rejection', isIdle());

  // ---------------------------------------------------------------- case 2
  // THE REGRESSION TEST. Second sign-in after a failed one, no relaunch.
  resetForTests();
  await runSerialized(async () => {
    await tick();
    throw new Error('first sign-in failed');
  }).catch(() => {});

  let secondRan = false;
  let secondError: unknown;
  try {
    await runSerialized(async () => {
      secondRan = true;
      await tick();
      return 'connected';
    });
  } catch (err) {
    secondError = err;
  }
  check('2a. a later call actually runs its work after an earlier failure', secondRan);
  check('2b. and is not poisoned by the earlier error', secondError === undefined, String(secondError));
  check('2c. the guard is idle again afterward', isIdle());

  // ---------------------------------------------------------------- case 3
  // A concurrent waiter must not inherit someone else's failure.
  resetForTests();
  let bRan = false;
  let aError: unknown;
  let bError: unknown;

  const a = runSerialized(async () => {
    await tick();
    throw new Error('A failed');
  }).catch((err) => {
    aError = err;
  });

  const b = runSerialized(async () => {
    bRan = true;
    await tick();
    return 'B done';
  }).catch((err) => {
    bError = err;
  });

  await Promise.all([a, b]);
  check('3a. A still sees A’s error', aError instanceof Error && aError.message === 'A failed');
  check('3b. B runs its own work despite A failing', bRan);
  check('3c. B does not inherit A’s error', bError === undefined, String(bError));
  check('3d. the guard is idle once both settle', isIdle());

  // ---------------------------------------------------------------- case 4
  // The reason the guard exists at all: no interleaving.
  resetForTests();
  const order: string[] = [];
  const first = runSerialized(async () => {
    order.push('A:start');
    await tick();
    order.push('A:end');
  });
  const second = runSerialized(async () => {
    order.push('B:start');
    await tick();
    order.push('B:end');
  });
  await Promise.all([first, second]);
  check(
    '4a. two overlapping calls do not interleave',
    order.join(',') === 'A:start,A:end,B:start,B:end',
    order.join(',')
  );
  check('4b. the guard is idle at the end', isIdle());
}

main().then(() => {
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
  process.exit(failed === 0 ? 0 : 1);
});
