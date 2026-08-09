// A UI-facing async call should never hang forever, no matter the cause.
// Found live during Phase 2 verification: a supabase-js `.from()` postgrest
// call can hang indefinitely (no resolve, no reject, no network request ever
// reaching the server -- confirmed via Kong/GoTrue access logs) on a second
// use of a session that was restored from storage on a previous app launch,
// after enough real time has passed that a token refresh would be due. The
// precise trigger inside supabase-js's internal refresh/session-lock
// machinery wasn't fully isolated despite substantial investigation (ruled
// out: concurrent SecureStore access, a stale storage adapter, RLS/grants --
// all confirmed fine via direct REST calls with a fresh token). Rather than
// ship a UI that can freeze silently and permanently on this, every
// UI-facing Supabase call in this app is wrapped with this timeout: past
// the deadline, the call fails loudly (so a spinner can turn into a retry
// prompt) instead of hanging forever.
export function withTimeout<T>(promise: PromiseLike<T>, ms = 8000, label = 'operation'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    );
  });
}
