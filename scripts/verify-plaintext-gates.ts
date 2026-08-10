/**
 * Phase 2 verification (Stage 6.5): the plaintext gates.
 *
 * SCOPE, stated as plainly as the other verify scripts. The rules under test
 * are imported and run for real -- lib/plaintext/policy.ts is deliberately
 * free of SQLite, SecureStore and React imports precisely so this script can
 * exercise the actual decision logic rather than a copy of it. What is NOT
 * covered here is the I/O around it (broker.ts, endpoints.ts): those are thin
 * wrappers over the database and the keychain, and they get verified on
 * device.
 *
 * The last section is a source check rather than a behavioural one, and it
 * earns its place: the guarantee "no feature can decrypt more than it asked
 * for" rests on the raw key never leaving lib/crypto/, which is a property of
 * the codebase, not of any single function.
 *
 * Run: npx tsx scripts/verify-plaintext-gates.ts
 */
import { execSync } from 'node:child_process';
import {
  EndpointFacts,
  decideAccess,
  gateValueFor,
  interpretGateValue,
} from '../lib/plaintext/policy';

let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

const endpoint = (over: Partial<EndpointFacts> = {}): EndpointFacts => ({
  id: 'e1',
  url: 'https://api.example.com/v1',
  use: 'ai',
  confirmedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

// --- gate interpretation ----------------------------------------------------
console.log('\n--- gate states ---');
{
  const off = interpretGateValue(null, NOW);
  check('null means OFF', !off.enabled && !off.expired);

  const forever = interpretGateValue('never', NOW);
  check("'never' means on with no expiry", forever.enabled && forever.expiresAt === null);

  const live = interpretGateValue(new Date(NOW + 10 * DAY).toISOString(), NOW);
  check('a future instant means on', live.enabled && !live.expired);

  const lapsed = interpretGateValue(new Date(NOW - 1).toISOString(), NOW);
  check('a past instant means off AND expired', !lapsed.enabled && lapsed.expired);

  // Distinguishing these two is what lets Settings say "Expired. Turn it back
  // on" rather than silently showing an off switch the user never touched.
  check('expired is distinguishable from never-enabled', lapsed.expired !== off.expired);

  const corrupt = interpretGateValue('not a date', NOW);
  check('an unparseable value fails CLOSED, not open', !corrupt.enabled);

  check(
    '90-day window lands 90 days out',
    Math.round((new Date(gateValueFor(90, NOW)).getTime() - NOW) / DAY) === 90
  );
  check("'never' window stores the sentinel", gateValueFor('never', NOW) === 'never');
}

// --- access decisions -------------------------------------------------------
console.log('\n--- access decisions ---');
{
  const on = interpretGateValue('never', NOW);
  const off = interpretGateValue(null, NOW);
  const expired = interpretGateValue(new Date(NOW - 1).toISOString(), NOW);

  const denied = (d: ReturnType<typeof decideAccess>) => (d.allow ? null : d.denied);

  check(
    'gate off denies with gate-off',
    denied(decideAccess({ gate: 'ai', gateState: off, noteIds: ['n1'], endpoint: endpoint() })) ===
      'gate-off'
  );
  check(
    'lapsed gate denies with gate-expired',
    denied(
      decideAccess({ gate: 'ai', gateState: expired, noteIds: ['n1'], endpoint: endpoint() })
    ) === 'gate-expired'
  );
  check(
    'an empty note list is refused -- there is no "all notes" form',
    denied(decideAccess({ gate: 'ai', gateState: on, noteIds: [], endpoint: endpoint() })) ===
      'no-notes'
  );
  check(
    'an unregistered destination is refused',
    denied(decideAccess({ gate: 'ai', gateState: on, noteIds: ['n1'], endpoint: null })) ===
      'unknown-endpoint'
  );
  check(
    'an endpoint with no URL is refused',
    denied(
      decideAccess({
        gate: 'ai',
        gateState: on,
        noteIds: ['n1'],
        endpoint: endpoint({ url: '' }),
      })
    ) === 'endpoint-incomplete'
  );

  // The cross-gate case: turning on AI access must not also open every
  // endpoint the user registered for the API gate.
  check(
    'the AI gate cannot reach an API endpoint',
    denied(
      decideAccess({
        gate: 'ai',
        gateState: on,
        noteIds: ['n1'],
        endpoint: endpoint({ use: 'api' }),
      })
    ) === 'unknown-endpoint'
  );

  const allowed = decideAccess({
    gate: 'ai',
    gateState: on,
    noteIds: ['n1', 'n2'],
    endpoint: endpoint(),
  });
  check('a confirmed endpoint on an open gate is allowed', allowed.allow === true);
  check('...and needs no further prompt', allowed.allow && allowed.needsConsent === false);

  const first = decideAccess({
    gate: 'ai',
    gateState: on,
    noteIds: ['n1'],
    endpoint: endpoint({ confirmedAt: null }),
  });
  check(
    'an unconfirmed endpoint is allowed but must prompt first',
    first.allow === true && first.needsConsent === true
  );

  // The ordering property, stated as a test: with the gate off, NOTHING about
  // the endpoint can change the answer. If any endpoint state could turn a
  // gate-off request into a decryption, the toggle would be decorative.
  const offAlwaysDenies = [
    endpoint(),
    endpoint({ confirmedAt: null }),
    endpoint({ url: '' }),
    endpoint({ use: 'api' }),
    null,
  ].every((e) => !decideAccess({ gate: 'ai', gateState: off, noteIds: ['n1'], endpoint: e }).allow);
  check('with the gate off, no endpoint state can produce an allow', offAlwaysDenies);
}

// --- the chokepoint ---------------------------------------------------------
console.log('\n--- chokepoint ---');
{
  // grep -l over the tracked sources. The claim is narrow and checkable: the
  // function that returns the raw key is referenced only inside lib/crypto/.
  // Matches a CALL -- `getDataKey(` -- or an import naming it. Deliberately
  // not any occurrence of the string: broker.ts's own header explains the
  // invariant by name, and a check that counts documentation as a violation
  // teaches people to stop documenting. `getDataKey(` also excludes
  // getDataKeyFingerprint, which returns a one-way tag rather than the key.
  const hits = execSync(
    `grep -rlE "getDataKey\\s*\\(|import[^;]*\\bgetDataKey\\b" --include="*.ts" --include="*.tsx" lib components contexts app scripts || true`,
    { encoding: 'utf-8' }
  )
    .split('\n')
    .filter(Boolean);

  // This file is excluded because the search pattern above is a string
  // literal inside it, so it matches itself. Every other script stays in
  // scope -- a fixture that reached for the key would still be caught.
  const outsiders = hits.filter(
    (f) => !f.startsWith('lib/crypto/') && f !== 'scripts/verify-plaintext-gates.ts'
  );
  check(
    'getDataKey is referenced only inside lib/crypto/',
    outsiders.length === 0,
    outsiders.length ? `leaked into: ${outsiders.join(', ')}` : hits.join(', ')
  );

  const brokerSource = execSync('cat lib/plaintext/broker.ts', { encoding: 'utf-8' });
  check(
    'the broker never imports the data key',
    !/import[^;]*\bgetDataKey\b/.test(brokerSource)
  );
  check(
    'the broker writes the audit row before releasing plaintext',
    brokerSource.indexOf('recordDisclosure') < brokerSource.indexOf('return {\n    ok: true')
  );

  // No PostgREST/Supabase path in the outbound plaintext route. Decryption
  // next to the server is the escrow this design forbids.
  //
  // Matches IMPORT LINES, not any mention: endpoints.ts refers to
  // lib/supabase/client.ts in a comment about SecureStore's size cap, and a
  // grep that can't tell a citation from a dependency is a check that will be
  // silenced rather than fixed.
  const supabaseImports = execSync(
    `grep -rnE "^\\s*import .*(@supabase/|lib/supabase)" lib/plaintext || true`,
    { encoding: 'utf-8' }
  ).trim();
  check('nothing in lib/plaintext imports Supabase', supabaseImports === '', supabaseImports);
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${failed} failing check(s)`);
process.exit(failed === 0 ? 0 : 1);
