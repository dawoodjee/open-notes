#!/usr/bin/env bash
# The Android twin of probe-local-db.sh: prove the local database is useless
# to anyone who pulls it off the device.
#
# Same reasoning as the iOS script -- a lock screen in front of a plaintext
# database is theatre, so this bypasses the app entirely and attacks the bytes
# on disk. The mechanics differ because the storage does:
#
#   iOS      the simulator's container is a normal directory on the Mac, so
#            the file can be read straight off the host filesystem.
#   Android  /data/data/<pkg> is not readable by the shell user. `run-as`
#            steps into the app's uid, which works because a debug build is
#            marked debuggable. On a release build this would refuse -- which
#            is the correct behaviour, and the reason this is a debug-only
#            diagnostic rather than a security control.
#
# Usage:  scripts/probe-local-db-android.sh [search-term]
#   search-term  a phrase you know is in one of your notes; defaults to "SECRET"

set -uo pipefail

PKG="com.adawoodjee.notes"
NEEDLE="${1:-SECRET}"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"

if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "No Android device/emulator attached."
  exit 1
fi

run_as() { "$ADB" exec-out run-as "$PKG" "$@" 2>&1; }

# Counts occurrences by CAPTURING OUTPUT, never by testing an exit status.
#
# This is not defensive style, it is a correctness fix for a real bug this
# script shipped with: `adb exec-out` returns ADB's own exit code, not the
# remote command's. So `if run_as grep -q ...` is always true, and the first
# version of this script duly reported a leak in every file it looked at --
# including a -journal file that did not exist. A probe that cannot fail
# correctly is worse than no probe, because it gets believed once and ignored
# forever after.
count_in() {
  local needle="$1" file="$2"
  run_as grep -a -c -- "$needle" "$file" 2>/dev/null | tr -dc '0-9' | head -c 8
}

file_exists() {
  [ "$(run_as sh -c "[ -f '$1' ] && echo yes || echo no" | tr -d '\r\n')" = "yes" ]
}

if ! run_as ls >/dev/null 2>&1; then
  echo "run-as refused for $PKG -- not installed, or not a debuggable build."
  exit 1
fi

echo "package: $PKG"
echo

echo "--- database files present ---"
run_as find . -name "notes*.db*" -o -name "*.sqlite*"
echo

DB=$(run_as find . -name "notes-v2.db" | head -1 | tr -d '\r')
LEGACY=$(run_as find . -name "notes.db" | head -1 | tr -d '\r')

if [ -n "$LEGACY" ]; then
  echo "!! A plaintext-era notes.db is still present at $LEGACY"
  echo "   migrateToEncrypted() should have deleted it after conversion."
  echo
fi

if [ -z "$DB" ]; then
  echo "No notes-v2.db found -- the encrypted database has not been created yet."
  exit 1
fi

echo "--- 1. SQLite header (expect: NOT 'SQLite format 3') ---"
# SQLCipher encrypts from byte 0, including the header. A plaintext SQLite
# file always begins with the ASCII string "SQLite format 3\0", so its absence
# is the single clearest signal that encryption is really on.
HEADER=$(run_as head -c 16 "$DB" | tr -d '\0')
if printf '%s' "$HEADER" | grep -q "SQLite format 3"; then
  echo "LEAK: file begins with a plaintext SQLite header -- encryption is NOT on"
else
  echo "ok: no SQLite header (first 16 bytes are not readable as one)"
fi
run_as xxd -l 16 "$DB" 2>/dev/null || run_as od -A x -t x1z -v -N 16 "$DB"
echo

echo "--- 2. does the note text leak? (expect: 0 matches) ---"
HITS_DB=$(count_in "$NEEDLE" "$DB")
if [ "${HITS_DB:-0}" -gt 0 ] 2>/dev/null; then
  echo "LEAK: '$NEEDLE' appears $HITS_DB time(s) in notes-v2.db"
else
  echo "clean: '$NEEDLE' does not appear in notes-v2.db (0 matches)"
fi
echo

echo "--- 3. same check across the WAL and journal sidecars ---"
# Easy to forget: SQLite writes recent pages to -wal before they reach the
# main file. An encrypted main database with a plaintext WAL beside it would
# leak exactly the notes you edited most recently.
for sidecar in "$DB-wal" "$DB-shm" "$DB-journal"; do
  if ! file_exists "$sidecar"; then
    echo "absent: $(basename "$sidecar")"
    continue
  fi
  HITS_SIDE=$(count_in "$NEEDLE" "$sidecar")
  if [ "${HITS_SIDE:-0}" -gt 0 ] 2>/dev/null; then
    echo "LEAK in $(basename "$sidecar"): $HITS_SIDE match(es)"
  else
    echo "clean: $(basename "$sidecar") (0 matches)"
  fi
done
echo

echo "--- 4. whole app sandbox, not just the database ---"
# Wider than the iOS script's equivalent on purpose: AsyncStorage is NOT
# encrypted, and neither are HTTP caches, so a note leaking there would be
# just as bad as one leaking from the database.
HITS=$(run_as grep -ral -- "$NEEDLE" . 2>/dev/null | tr -d '\r')
if [ -n "$HITS" ]; then
  echo "LEAK outside the database:"
  echo "$HITS"
else
  echo "clean: '$NEEDLE' appears nowhere in the app's private storage"
fi
