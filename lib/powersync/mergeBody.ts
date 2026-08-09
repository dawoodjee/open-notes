import { diff_match_patch } from 'diff-match-patch';

// One shared instance -- diff_match_patch is stateless between calls (all
// tuning lives in these instance fields), so there's no reason to allocate
// one per merge.
const dmp = new diff_match_patch();

// How far patch_apply may search from a patch's expected offset before giving
// up. The default (32) is tuned for short strings; note bodies are HTML, where
// a single edit near the top shifts every later offset by more than that, so
// well-separated edits would fail to apply purely because they moved. 1000 is
// comfortably past any realistic shift within one note.
dmp.Match_Distance = 1000;

// How much fuzziness to tolerate when locating context. 0.5 is the library
// default; stated explicitly because it's the knob that decides "same region,
// slightly moved" (merge) vs "can't find it, give up" (fall back).
dmp.Match_Threshold = 0.5;

export interface MergeResult {
  body: string;
  /**
   * 'clean'    -- server hasn't moved since our ancestor; nothing to merge.
   * 'merged'   -- both sides changed and every local edit applied cleanly.
   * 'partial'  -- both sides changed and at least one local hunk could not be
   *               placed; that hunk lost, the server's text for it stands.
   * 'no-base'  -- no ancestor recorded, so a real merge isn't possible.
   */
  outcome: 'clean' | 'merged' | 'partial' | 'no-base';
}

/**
 * Three-way merge of a note body: what we have locally, what the server has
 * now, and the last version both agreed on (`base`).
 *
 * The naive alternative is last-write-wins -- upload `local` and let it
 * replace `server`. That throws away the other device's entire edit even when
 * the two touched completely different paragraphs, which is the case that
 * actually matters: two devices, both offline, editing different parts of the
 * same note.
 *
 * The trick is that `local` on its own doesn't tell you what this device
 * *changed*; only the difference between `base` and `local` does. So we take
 * that difference as a patch and replay it onto the server's current text.
 * Edits to different regions then compose naturally, because each patch
 * carries its own surrounding context and diff-match-patch locates it by that
 * context rather than by a byte offset that the other device's edit has
 * already invalidated.
 *
 * Known limit, stated plainly: this merges the raw HTML string that `body`
 * holds, not the rich-text document it represents. Edits in different
 * paragraphs merge correctly. Two edits inside the same sentence can still
 * produce odd markup, and a hunk that can't be placed is reported as
 * 'partial' rather than silently pretended to have worked. Fixing that
 * properly means a CRDT-backed editor, which is a different project.
 */
export function mergeBody(base: string | null, local: string, server: string): MergeResult {
  // Server matches the ancestor: nobody else touched this note since we last
  // agreed, so our version is simply the newer one. The common path.
  if (base !== null && base === server) {
    return { body: local, outcome: 'clean' };
  }

  // Server already matches us -- someone (probably this device, via an
  // earlier op in the same queue) got there first. Nothing to do.
  if (local === server) {
    return { body: local, outcome: 'clean' };
  }

  // No ancestor: this note has never completed a round trip on this device,
  // so there's no way to know which side changed what. Overwriting is the
  // honest fallback -- but it's reported, not hidden, so the caller can
  // decide whether that's acceptable.
  if (base === null) {
    return { body: local, outcome: 'no-base' };
  }

  const patches = dmp.patch_make(base, local);
  if (patches.length === 0) {
    // We changed nothing since the ancestor; the server's version is strictly
    // newer. Take theirs rather than pushing a stale copy back over it.
    return { body: server, outcome: 'clean' };
  }

  const [merged, applied] = dmp.patch_apply(patches, server);
  const allApplied = applied.every(Boolean);

  return {
    body: merged,
    outcome: allApplied ? 'merged' : 'partial',
  };
}
