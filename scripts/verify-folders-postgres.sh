#!/usr/bin/env bash
#
# Stage 10 — the half of the folder verification that only Postgres can answer.
#
# Everything here is exercised against the REAL schema in the real local
# database: no transcription, no mocks. That matters because the claims being
# checked are all claims ABOUT the database -- the depth trigger, the RLS
# policies, the delete semantics, the trashed_at constraint. A TypeScript
# harness could only assert that the client sends the right SQL, not that the
# server does the right thing with it.
#
# RLS is evaluated the way PostgREST evaluates it: assume the `authenticated`
# role and set request.jwt.claims, which is what auth.uid() reads. Running as
# postgres would prove nothing -- the table owner is exempt from its own RLS.
#
# Usage: scripts/verify-folders-postgres.sh
set -uo pipefail

CONTAINER="supabase_db_notes"
FAILED=0

q() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAc "$1" 2>&1; }
qq() { docker exec -i "$CONTAINER" psql -U postgres -d postgres -c "$1" 2>&1; }

# psql prints a command tag ("INSERT 0 1") on success, so "produced output" is
# not the same as "failed". Anything that isn't a tag is the error text.
err_of() {
  local out="$1"
  [[ "$out" =~ ^(INSERT|UPDATE|DELETE)\ [0-9]+( [0-9]+)?$ ]] && return 0
  printf '%s' "$out"
}

check() {
  local name="$1" cond="$2" detail="${3:-}"
  if [[ "$cond" == "1" ]]; then
    printf 'PASS  %s\n' "$name"
  else
    FAILED=$((FAILED + 1))
    printf 'FAIL  %s\n' "$name"
    [[ -n "$detail" ]] && printf '      %s\n' "$detail"
  fi
}

# Two throwaway accounts. Real auth.users rows, because folders.user_id has a
# foreign key to them and RLS compares against them.
A=$(q "select gen_random_uuid()")
B=$(q "select gen_random_uuid()")

cleanup() {
  q "delete from public.folders where user_id in ('$A','$B')" >/dev/null
  q "delete from public.notes where user_id in ('$A','$B')" >/dev/null
  q "delete from auth.users where id in ('$A','$B')" >/dev/null
}
trap cleanup EXIT

for U in "$A" "$B"; do
  q "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ('$U','00000000-0000-0000-0000-000000000000','authenticated','authenticated','$U@verify.local','x',now(),now(),now())" >/dev/null
done

echo "=== 1. Hierarchy: 5 levels allowed, the 6th refused ==="

PARENT="null"
IDS=()
for LEVEL in 0 1 2 3 4; do
  ID=$(q "select gen_random_uuid()")
  IDS+=("$ID")
  ERR=$(err_of "$(q "insert into public.folders (id, user_id, parent_id, name, kind)
           values ('$ID','$A',$PARENT,'enc:v1:fake:level$LEVEL','user')")")
  if [[ -n "$ERR" ]]; then
    check "level $((LEVEL + 1)) inserts" 0 "$ERR"
  else
    DEPTH=$(q "select depth from public.folders where id='$ID'")
    check "level $((LEVEL + 1)) inserts, depth=$DEPTH" "$([[ "$DEPTH" == "$LEVEL" ]] && echo 1 || echo 0)" "expected depth $LEVEL, got $DEPTH"
  fi
  PARENT="'$ID'"
done

# The 6th. The trigger computes depth = 5, the check constraint rejects it.
SIXTH=$(q "select gen_random_uuid()")
ERR=$(q "insert into public.folders (id, user_id, parent_id, name, kind)
         values ('$SIXTH','$A',$PARENT,'enc:v1:fake:level5','user')")
echo "$ERR" | grep -q "folders_depth_range" && REFUSED=1 || REFUSED=0
check "level 6 is REFUSED by folders_depth_range" "$REFUSED" "server said: ${ERR:-<no error -- it was accepted>}"

# And a client that lies about depth is not believed: the trigger overwrites it.
LIAR=$(q "select gen_random_uuid()")
ERR=$(q "insert into public.folders (id, user_id, parent_id, name, kind, depth)
         values ('$LIAR','$A',$PARENT,'enc:v1:fake:liar','user',0)")
echo "$ERR" | grep -q "folders_depth_range" && REFUSED=1 || REFUSED=0
check "a client-supplied depth=0 at level 6 is still refused" "$REFUSED" "server said: ${ERR:-<accepted>}"

echo
echo "=== 2. Folder names are genuine ciphertext on the server ==="
qq "select substring(name for 40) as stored_name, kind, depth from public.folders where user_id='$A' order by depth"
PLAIN=$(q "select count(*) from public.folders where user_id='$A' and name not like 'enc:v1:%'")
check "every folder name is an enc:v1 envelope" "$([[ "$PLAIN" == "0" ]] && echo 1 || echo 0)" "$PLAIN rows stored in the clear"

echo
echo "=== 3. RLS: account B cannot read account A's folders ==="
SEEN=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAc "
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"$B\",\"role\":\"authenticated\"}';
  select count(*) from public.folders where user_id='$A';" 2>&1 | tail -1)
check "B reads 0 of A's folder rows" "$([[ "$SEEN" == "0" ]] && echo 1 || echo 0)" "B saw $SEEN"

OWN=$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -tAc "
  set local role authenticated;
  set local request.jwt.claims = '{\"sub\":\"$A\",\"role\":\"authenticated\"}';
  select count(*) from public.folders;" 2>&1 | tail -1)
check "A still reads its own 5 folders" "$([[ "$OWN" == "5" ]] && echo 1 || echo 0)" "A saw $OWN"

# Referencing another account's folder as a parent is refused by the trigger,
# not merely hidden by RLS -- RLS stops B SELECTing it, not naming it by id.
CROSS=$(q "select gen_random_uuid()")
ERR=$(q "insert into public.folders (id, user_id, parent_id, name, kind)
         values ('$CROSS','$B','${IDS[0]}','enc:v1:fake:cross','user')")
echo "$ERR" | grep -q "different account" && REFUSED=1 || REFUSED=0
check "B cannot nest under A's folder" "$REFUSED" "server said: ${ERR:-<accepted>}"

echo
echo "=== 4. Deleting a folder does not destroy its notes ==="
# A note in the level-1 folder and a note in the level-3 folder, so the test
# covers a nested subfolder rather than only the folder named in the delete.
N1=$(q "select gen_random_uuid()")
N2=$(q "select gen_random_uuid()")
q "insert into public.notes (id,user_id,body,title,folder_id) values ('$N1','$A','enc:v1:x','enc:v1:x','${IDS[1]}')" >/dev/null
q "insert into public.notes (id,user_id,body,title,folder_id) values ('$N2','$A','enc:v1:y','enc:v1:y','${IDS[3]}')" >/dev/null

# What the client does, in the client's order: trash first (while folder_id
# still points somewhere), then delete the folders.
NOW=$(q "select now()")
q "update public.notes set is_trashed=true, trashed_at=now()
   where folder_id in ('${IDS[1]}','${IDS[2]}','${IDS[3]}','${IDS[4]}')" >/dev/null
q "delete from public.folders where id='${IDS[1]}'" >/dev/null

SURVIVING=$(q "select count(*) from public.notes where id in ('$N1','$N2')")
check "both notes still exist after the folder is deleted" "$([[ "$SURVIVING" == "2" ]] && echo 1 || echo 0)" "only $SURVIVING of 2 survived"

TRASHED=$(q "select count(*) from public.notes where id in ('$N1','$N2') and is_trashed and trashed_at is not null")
check "both are in Recently Deleted with a trashed_at" "$([[ "$TRASHED" == "2" ]] && echo 1 || echo 0)" "$TRASHED of 2"

UNFILED=$(q "select count(*) from public.notes where id in ('$N1','$N2') and folder_id is null")
check "both were unfiled by on-delete-set-null (not cascade-deleted)" "$([[ "$UNFILED" == "2" ]] && echo 1 || echo 0)" "$UNFILED of 2"

GONE=$(q "select count(*) from public.folders where id in ('${IDS[1]}','${IDS[2]}','${IDS[3]}','${IDS[4]}')")
check "the whole subtree of 4 folders is gone" "$([[ "$GONE" == "0" ]] && echo 1 || echo 0)" "$GONE folders left behind"

echo
echo "=== 5. trashed_at cannot disagree with is_trashed ==="
BAD=$(q "select gen_random_uuid()")
ERR=$(q "insert into public.notes (id,user_id,body,title,is_trashed,trashed_at) values ('$BAD','$A','','',true,null)")
echo "$ERR" | grep -q "notes_trashed_at_matches_flag" && REFUSED=1 || REFUSED=0
check "trashed with no timestamp is refused" "$REFUSED" "server said: ${ERR:-<accepted>}"

ERR=$(q "insert into public.notes (id,user_id,body,title,is_trashed,trashed_at) values ('$BAD','$A','','',false,now())")
echo "$ERR" | grep -q "notes_trashed_at_matches_flag" && REFUSED=1 || REFUSED=0
check "untrashed WITH a timestamp is refused" "$REFUSED" "server said: ${ERR:-<accepted>}"

echo
echo "=== 6. One Skills folder per account ==="
S1=$(q "select gen_random_uuid()")
S2=$(q "select gen_random_uuid()")
q "insert into public.folders (id,user_id,name,kind) values ('$S1','$A','enc:v1:skills','skills')" >/dev/null
ERR=$(q "insert into public.folders (id,user_id,name,kind) values ('$S2','$A','enc:v1:skills','skills')")
echo "$ERR" | grep -q "folders_one_skills_per_user" && REFUSED=1 || REFUSED=0
check "a second Skills row is refused" "$REFUSED" "server said: ${ERR:-<accepted>}"

ERR=$(err_of "$(q "insert into public.folders (id,user_id,name,kind) values ('$S2','$B','enc:v1:skills','skills')")")
check "B may still have its own Skills folder" "$([[ -z "$ERR" ]] && echo 1 || echo 0)" "$ERR"

echo
echo "=== 7. Replication ==="
PUB=$(q "select count(*) from pg_publication_tables where pubname='powersync' and tablename='folders'")
check "folders is in the powersync publication" "$([[ "$PUB" == "1" ]] && echo 1 || echo 0)" "found $PUB"
GRANTED=$(q "select count(*) from information_schema.role_table_grants where grantee='powersync_role' and table_name='folders' and privilege_type='SELECT'")
check "powersync_role can SELECT folders" "$([[ "$GRANTED" == "1" ]] && echo 1 || echo 0)" "found $GRANTED"

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "All checks passed."
else
  echo "$FAILED check(s) FAILED."
fi
exit "$FAILED"
