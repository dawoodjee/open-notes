/**
 * Two questions about an account created purely through Google:
 *
 *  1. Can it sign in by email OTP? (i.e. is email really a usable second way
 *     in, as the UI would be claiming if it let you remove Google.)
 *  2. Will Supabase actually let that account unlink its only identity?
 *
 * Read-only in effect: if the unlink succeeds it is immediately relinked-- no,
 * it can't be, so the script stops before committing anything destructive
 * unless ALLOW_UNLINK=1 is set explicitly.
 *
 * Usage: npx tsx scripts/probe-unlink-last-identity.ts
 */
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const EMAIL = process.env.PROBE_EMAIL ?? 'adam.dawoodjee@gmail.com';

const wsOptions = { realtime: { transport: ws as any } };

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, wsOptions);

  console.log('--- Q1: can a Google-only account sign in by email OTP? ---');
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: EMAIL,
  });
  if (linkError) {
    console.log('  NO -- generateLink failed:', linkError.message);
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, wsOptions);
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    type: 'magiclink',
    token_hash: (linkData.properties as any).hashed_token,
  });
  if (verifyError) {
    console.log('  NO -- OTP verify failed:', verifyError.message);
    process.exit(1);
  }
  console.log('  YES -- signed in by email, user id:', verified.session!.user.id);

  console.log('\n--- identities on the account ---');
  const { data: idData, error: idError } = await anon.auth.getUserIdentities();
  if (idError) {
    console.log('  failed to list identities:', idError.message);
    process.exit(1);
  }
  const list = idData?.identities ?? [];
  for (const i of list) console.log(`  ${i.provider}  (${i.identity_id})`);

  const google = list.find((i) => i.provider === 'google');
  if (!google) {
    console.log('\nNo google identity -- nothing to probe.');
    process.exit(0);
  }

  console.log('\n--- Q2: will Supabase allow unlinking it? ---');
  if (process.env.ALLOW_UNLINK !== '1') {
    console.log('  (dry run -- set ALLOW_UNLINK=1 to actually attempt it)');
    process.exit(0);
  }

  const { error: unlinkError } = await anon.auth.unlinkIdentity(google);
  if (unlinkError) {
    console.log('  REFUSED:', unlinkError.message, `(status ${(unlinkError as any).status})`);
  } else {
    console.log('  ALLOWED -- the google identity was removed.');
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
