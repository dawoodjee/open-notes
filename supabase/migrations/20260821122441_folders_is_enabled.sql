-- =============================================================================
-- Stage 10, review round 2 — folders.is_enabled
--
-- A folder that is switched off. Only the Skills folder exposes the toggle
-- today, hence the generic column name rather than a Skills-specific one: the
-- concept is "this folder is stood down", and nothing about it is special to
-- Skills.
--
-- WHY THIS IS A COLUMN AND NOT A BULK WRITE OVER THE NOTES.
-- Disabling Skills has to make its notes invisible to apps. The obvious
-- implementation -- set is_hidden_from_api = 1 on every note inside -- is
-- lossy: it destroys whichever notes the user had *individually* hidden, so
-- re-enabling cannot put them back and quietly exposes notes that were meant to
-- stay hidden. A flag consulted at read time is reversible with no data loss,
-- which is the property that matters for anything governing disclosure.
--
-- Enforcement lives in lib/plaintext/broker.ts and lib/plaintext/mcp.ts, as an
-- ADDITIONAL filter on the queries that were already there. That is not a
-- second mechanism competing with is_hidden_from_api -- it is a stricter
-- predicate at the same chokepoint, so it can only ever remove access, never
-- widen it, and nothing bypasses the broker.
--
-- Synced rather than per-device, matching the recorded decision that folder
-- organisational state syncs: a folder switched off on the iPad reading as
-- present on the phone would look like a sync bug.
-- =============================================================================

alter table public.folders
  add column is_enabled boolean not null default true;
