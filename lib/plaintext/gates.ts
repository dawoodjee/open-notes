import { getUiState, saveUiState } from '@/lib/powersync/db';
import { GateState, GateWindow, gateValueFor, interpretGateValue } from './policy';

/**
 * The standing permission to send plaintext off this device. Storage and
 * retrieval only -- the rules live in ./policy.ts so they can be tested for
 * real under Node.
 *
 * ON THE RECORD, because it reverses something written down last stage:
 * NOTES.md originally said "per-action consent, not a settings toggle", on the
 * grounds that a switch buried in settings which silently uploads plaintext
 * forever is exactly what end-to-end encryption exists to prevent. That
 * objection was right about the failure mode, and is answered here rather than
 * ignored -- the gate is a toggle PLUS three things that blunt it:
 *
 *   1. an expiry, so the permission lapses instead of outliving the reason for
 *      it (30 / 90 / 365 days, or Forever if the user insists);
 *   2. per-request scope -- ./broker.ts takes explicit note ids, and there is
 *      deliberately no "all";
 *   3. a first-use consent prompt per destination, plus an audit row for every
 *      disclosure.
 *
 * What is NOT negotiable, and is unchanged: the server never gains the ability
 * to decrypt. No key copy, no escrow. Plaintext leaves only because this
 * device decrypted it for one named request.
 */

export type { GateState, GateWindow };

export const GATE_WINDOW_OPTIONS: { label: string; value: GateWindow }[] = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: 'Forever', value: 'never' },
];

export async function getGateState(): Promise<GateState> {
  const { apiGateExpiresAt } = await getUiState();
  return interpretGateValue(apiGateExpiresAt);
}

export async function openGate(window: GateWindow): Promise<void> {
  await saveUiState({ apiGateExpiresAt: gateValueFor(window) });
}

export async function closeGate(): Promise<void> {
  // Explicit null, not undefined -- saveUiState distinguishes "set to off"
  // from "not supplied", and undefined would leave the gate open.
  await saveUiState({ apiGateExpiresAt: null });
}
