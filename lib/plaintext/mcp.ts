import { getPowerSync } from '@/lib/powersync/db';
import { requestPlaintext, BrokerResult, PlaintextNote } from './broker';

/**
 * Where a tool-calling integration plugs into the gates.
 *
 * SCOPE, stated plainly: there is no MCP server in this repo yet. This is the
 * seam, not the integration -- it exists so that whoever adds one cannot
 * accidentally reach note content without going through the broker, and so
 * the shape of "a tool that needs plaintext" is decided now, while the
 * security model is fresh, rather than under delivery pressure later.
 *
 * The rule it encodes: a tool gets plaintext ONLY if its manifest says it
 * needs plaintext. Everything else gets metadata, which is safe to hand over
 * because those columns were never encrypted in the first place -- id,
 * timestamps and trash state are unencrypted by design so that RLS and the
 * sync rules can filter on them (see lib/powersync/db.ts).
 *
 * Default-deny is the point. `requiresPlaintext` is not optional-and-assumed-
 * true; a tool that forgets to declare it gets metadata and works in a
 * degraded way, rather than silently getting the notes.
 */

export interface ToolManifest {
  name: string;
  description: string;
  /** Must be declared. Omitting it is not the same as asking for it. */
  requiresPlaintext: boolean;
}

/** The unencrypted columns. Safe for any tool, plaintext-approved or not. */
export interface NoteMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
  isTrashed: boolean;
}

export async function listNoteMetadata(): Promise<NoteMetadata[]> {
  // Deliberately does not select title or body. Not "selects them and drops
  // them" -- a query that never reads the ciphertext cannot leak it through a
  // logged row or a stray spread.
  const rows = await getPowerSync().getAll<any>(
    'SELECT id, created_at, updated_at, is_trashed FROM notes ORDER BY updated_at DESC'
  );
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isTrashed: row.is_trashed === 1,
  }));
}

export type ToolInvocation =
  | { kind: 'metadata'; notes: NoteMetadata[] }
  | { kind: 'plaintext'; notes: PlaintextNote[]; endpointUrl: string; token: string | null }
  | { kind: 'denied'; reason: string };

/**
 * Resolve what a tool is allowed to see, immediately before invoking it.
 *
 * Called per invocation rather than per session on purpose: the gate can lapse
 * mid-session, and a permission checked once at startup would outlive its
 * expiry.
 */
export async function resolveToolAccess(
  manifest: ToolManifest,
  request: { noteIds: string[]; endpointId: string }
): Promise<ToolInvocation> {
  if (!manifest.requiresPlaintext) {
    return { kind: 'metadata', notes: await listNoteMetadata() };
  }

  const result: BrokerResult = await requestPlaintext({
    noteIds: request.noteIds,
    purpose: manifest.description,
    endpointId: request.endpointId,
  });

  if (!result.ok) return { kind: 'denied', reason: result.denied };

  return {
    kind: 'plaintext',
    notes: result.grant.consume(),
    endpointUrl: result.grant.endpoint.url,
    token: result.grant.token,
  };
}
