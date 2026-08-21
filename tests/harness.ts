/**
 * A very small test harness, run with `tsx` (`npm test`).
 *
 * WHY NOT JEST OR VITEST. Both are new dependencies, and adding one is a call
 * that belongs to Adam under the project's own rules rather than something to
 * slip in alongside a stage. `tsx` is already a devDependency and already used
 * for one-off checks, so this costs nothing to adopt and can be thrown away the
 * moment a real runner arrives -- the test files themselves are written in a
 * shape (`describe`/`it`/`expect`) that a real runner would recognise.
 *
 * Deliberately tiny: it reports failures with actual-vs-expected and exits
 * non-zero, which is the whole contract CI needs.
 */

interface Failure {
  suite: string;
  name: string;
  message: string;
}

const failures: Failure[] = [];
let passed = 0;
let currentSuite = '';

export function describe(name: string, body: () => void) {
  const previous = currentSuite;
  currentSuite = previous ? `${previous} > ${name}` : name;
  body();
  currentSuite = previous;
}

export function it(name: string, body: () => void) {
  try {
    body();
    passed += 1;
  } catch (err) {
    failures.push({
      suite: currentSuite,
      name,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (!Object.is(actual, expected)) {
        throw new Error(`expected ${show(expected)}, got ${show(actual)}`);
      }
    },
    toEqual(expected: unknown) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`expected ${b}, got ${a}`);
    },
    toContain(needle: string) {
      if (typeof actual !== 'string' || !actual.includes(needle)) {
        throw new Error(`expected ${show(actual)} to contain ${show(needle)}`);
      }
    },
  };
}

export function report(): never {
  const total = passed + failures.length;
  if (failures.length === 0) {
    console.log(`\n✓ ${passed}/${total} passed`);
    process.exit(0);
  }
  console.log(`\n✗ ${failures.length} of ${total} failed:\n`);
  for (const f of failures) {
    console.log(`  ${f.suite} > ${f.name}`);
    console.log(`    ${f.message}\n`);
  }
  process.exit(1);
}
