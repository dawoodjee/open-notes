import * as Crypto from 'expo-crypto';
import { getPowerSync } from '@/lib/powersync/db';
import { tryDecryptField } from '@/lib/crypto/noteCrypto';
import { getGateState } from './gates';
import { DenialReason, Gate, decideAccess } from './policy';
import {
  Endpoint,
  getEndpoint,
  getEndpointToken,
  markEndpointConfirmed,
  markEndpointUsed,
} from './endpoints';
import { askForConsent } from './consent';

/**
 * THE ONLY PLACE IN THIS APP THAT MAY HAND DECRYPTED NOTE CONTENT TO ANYTHING
 * OUTBOUND.
 *
 * This file is to plaintext what becomeAuthenticatedLocally() in
 * contexts/AuthContext.tsx is to sync connections: a deliberate chokepoint,
 * enforced the same way. That function's comment says "grep for `.connect(` to
 * confirm"; the equivalent here is that `getDataKey` has no caller outside
 * lib/crypto/ -- asserted mechanically by scripts/verify-plaintext-gates.ts
 * and by a no-restricted-imports rule in eslint.config.js.
 *
 * Three properties carry the guarantee, and each is here because the obvious
 * simpler design loses it:
 *
 *   1. IT NEVER RETURNS THE DATA KEY. Handing a feature the key would make
 *      every later "did that feature only read what it was given?" question
 *      unanswerable. It returns decrypted text for the note ids it was
 *      explicitly asked for, so a compromised or careless caller cannot reach
 *      anything it was not handed.
 *
 *   2. THE GRANT IS SINGLE-USE AND TIME-BOUNDED. A long-lived object holding
 *      plaintext is a second copy of the notes with no owner. Consuming it
 *      wipes it.
 *
 *   3. THE AUDIT ROW IS WRITTEN BEFORE THE PLAINTEXT IS RELEASED, not after
 *      the call succeeds. The interesting question is what was exposed, and a
 *      request that dies halfway still exposed it.
 *
 * What this deliberately is NOT: a route to the server. There is no
 * PostgREST/Supabase path here. Putting decryption next to the server is the
 * exact escrow this design forbids, however convenient it would be.
 */

export type { DenialReason };

export interface PlaintextNote {
  id: string;
  title: string;
  body: string;
}

export interface PlaintextGrant {
  gate: Gate;
  endpoint: Endpoint;
  token: string | null;
  /**
   * Hands over the plaintext exactly once. A second call throws rather than
   * returning stale content -- a caller that needs it twice should hold what
   * it got, deliberately, rather than the broker keeping a copy alive.
   */
  consume: () => PlaintextNote[];
}

export interface PlaintextRequest {
  gate: Gate;
  /** Explicit. There is deliberately no "all notes" form. */
  noteIds: string[];
  /** Shown to the user in the consent prompt and recorded in the audit log. */
  purpose: string;
  endpointId: string;
}

export type BrokerResult =
  | { ok: true; grant: PlaintextGrant }
  | { ok: false; denied: DenialReason };

export async function requestPlaintext(req: PlaintextRequest): Promise<BrokerResult> {
  // Every refusal that can be decided without the encryption key is decided
  // here, before anything is decrypted. That ordering is what makes "the gate
  // is off" a real property rather than a discarded result -- see
  // ./policy.ts, where the rules live so they can be tested directly.
  const gateState = await getGateState(req.gate);
  const endpoint = await getEndpoint(req.endpointId);
  const decision = decideAccess({
    gate: req.gate,
    gateState,
    noteIds: req.noteIds,
    endpoint,
  });
  if (!decision.allow) return { ok: false, denied: decision.denied };
  // decideAccess only allows when the endpoint resolved, but narrowing that
  // through the return type would make the rules harder to read than this
  // one redundant line is to keep.
  if (!endpoint) return { ok: false, denied: 'unknown-endpoint' };

  if (decision.needsConsent) {
    const approved = await askForConsent(endpoint, req.purpose, req.noteIds.length);
    if (!approved) return { ok: false, denied: 'user-declined' };
    await markEndpointConfirmed(endpoint.id);
  }

  // Only now is anything decrypted.
  const placeholders = req.noteIds.map(() => '?').join(',');
  const rows = await getPowerSync().getAll<any>(
    `SELECT id, title, body FROM notes WHERE id IN (${placeholders}) AND is_trashed = 0`,
    req.noteIds
  );
  if (rows.length === 0) return { ok: false, denied: 'no-notes' };

  const notes: PlaintextNote[] = [];
  for (const row of rows) {
    const title = tryDecryptField(row.title);
    const body = tryDecryptField(row.body);
    // Refuse rather than send a partial or garbled note. Silently shipping
    // whatever decrypted is how a bad key turns into a corrupt disclosure.
    if (!title.ok || !body.ok) return { ok: false, denied: 'undecryptable' };
    notes.push({ id: row.id, title: title.text, body: body.text });
  }

  const byteCount = notes.reduce((sum, n) => sum + n.title.length + n.body.length, 0);
  await recordDisclosure({
    gate: req.gate,
    noteIds: notes.map((n) => n.id),
    endpointId: endpoint.id,
    purpose: req.purpose,
    byteCount,
  });
  await markEndpointUsed(endpoint.id);

  return {
    ok: true,
    grant: makeGrant(req.gate, endpoint, await getEndpointToken(endpoint.id), notes),
  };
}

function makeGrant(
  gate: Gate,
  endpoint: Endpoint,
  token: string | null,
  notes: PlaintextNote[]
): PlaintextGrant {
  let held: PlaintextNote[] | null = notes;

  // Belt and braces: even a caller that never consumes the grant does not get
  // to keep plaintext alive indefinitely by holding the object.
  const timer = setTimeout(() => {
    held = null;
  }, GRANT_TTL_MS);

  return {
    gate,
    endpoint,
    token,
    consume() {
      if (!held) {
        throw new Error(
          'This plaintext grant has already been used or has expired. Request a new one.'
        );
      }
      const out = held;
      held = null;
      clearTimeout(timer);
      return out;
    },
  };
}

const GRANT_TTL_MS = 60_000;

async function recordDisclosure(entry: {
  gate: Gate;
  noteIds: string[];
  endpointId: string;
  purpose: string;
  byteCount: number;
}): Promise<void> {
  await getPowerSync().execute(
    `INSERT INTO plaintext_disclosures (id, occurred_at, gate, note_ids, endpoint_id, purpose, byte_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      Crypto.randomUUID(),
      new Date().toISOString(),
      entry.gate,
      JSON.stringify(entry.noteIds),
      entry.endpointId,
      entry.purpose,
      entry.byteCount,
    ]
  );
}

export interface Disclosure {
  id: string;
  occurredAt: string;
  gate: Gate;
  noteIds: string[];
  endpointId: string;
  purpose: string;
  byteCount: number;
}

export async function listDisclosures(limit = 50): Promise<Disclosure[]> {
  const rows = await getPowerSync().getAll<any>(
    `SELECT id, occurred_at, gate, note_ids, endpoint_id, purpose, byte_count
     FROM plaintext_disclosures ORDER BY occurred_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    gate: row.gate as Gate,
    noteIds: JSON.parse(row.note_ids || '[]'),
    endpointId: row.endpoint_id,
    purpose: row.purpose ?? '',
    byteCount: row.byte_count ?? 0,
  }));
}

export async function clearDisclosures(): Promise<void> {
  await getPowerSync().execute('DELETE FROM plaintext_disclosures');
}
