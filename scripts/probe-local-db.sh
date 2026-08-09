#!/usr/bin/env bash
# Stage 6 Phase 1, check 3: prove the local database is useless to anyone who
# pulls it off the device.
#
# This is the check that actually matters. "The app asks for a PIN" proves
# nothing about the bytes on disk -- a lock screen in front of a plaintext
# database is theatre. So this bypasses the app entirely: it finds the real
# file in the simulator's container and attacks it with the same tools an
# attacker would reach for first.
#
# Usage:  scripts/probe-local-db.sh [search-term]
#   search-term  a phrase you know is in one of your notes; defaults to "SECRET"
#
# Expected result after Phase 1: sqlite3 refuses to open the file, and the
# search term appears nowhere in it.

set -uo pipefail

BUNDLE_ID="com.adawoodjee.notes"
NEEDLE="${1:-SECRET}"

CONTAINER=$(xcrun simctl get_app_container booted "$BUNDLE_ID" data 2>/dev/null)
if [ -z "$CONTAINER" ]; then
  echo "Could not locate the app container. Is a simulator booted with the app installed?"
  exit 1
fi

echo "container: $CONTAINER"
echo

# PowerSync/op-sqlite put the database in Documents. Listed rather than
# assumed, so a renamed or unexpected file shows up instead of being missed.
echo "--- database files present ---"
find "$CONTAINER" -name "notes*.db*" -o -name "*.sqlite*" | sed "s|$CONTAINER|.|"
echo

DB=$(find "$CONTAINER" -name "notes-v2.db" | head -1)
LEGACY=$(find "$CONTAINER" -name "notes.db" | head -1)

if [ -n "$LEGACY" ]; then
  echo "!! A plaintext-era notes.db is still present at ${LEGACY/$CONTAINER/.}"
  echo "   migrateToEncrypted() should have deleted it after conversion."
  echo
fi

if [ -z "$DB" ]; then
  echo "No notes-v2.db found -- the encrypted database has not been created yet."
  exit 1
fi

echo "--- 1. can sqlite3 open it? (expect: 'file is not a database') ---"
sqlite3 "$DB" "SELECT count(*) FROM sqlite_master;" 2>&1 | head -3
echo

echo "--- 2. file magic (expect: 'data', NOT 'SQLite 3.x database') ---"
file -b "$DB"
head -c 16 "$DB" | xxd | head -1
echo

echo "--- 3. does the note text leak? (expect: no matches) ---"
if strings "$DB" | grep -q -- "$NEEDLE"; then
  echo "LEAK: found '$NEEDLE' in plaintext:"
  strings "$DB" | grep -- "$NEEDLE" | head -5
else
  echo "clean: '$NEEDLE' does not appear in $(basename "$DB")"
fi
echo

echo "--- 4. same check across the WAL and journal sidecars ---"
# Easy to forget: SQLite writes recent pages to -wal before they reach the
# main file. An encrypted main database with a plaintext WAL beside it would
# leak exactly the notes you edited most recently.
for sidecar in "$DB-wal" "$DB-shm" "$DB-journal"; do
  [ -f "$sidecar" ] || continue
  if strings "$sidecar" | grep -q -- "$NEEDLE"; then
    echo "LEAK in $(basename "$sidecar"):"
    strings "$sidecar" | grep -- "$NEEDLE" | head -3
  else
    echo "clean: $(basename "$sidecar")"
  fi
done
