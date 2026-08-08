import { Session } from '@supabase/supabase-js';

// full_name ("Adam Dawoodjee" -> "AD") takes priority since it's the
// user-facing display name; falls back to the email local-part's first two
// letters when there's no full_name yet (e.g. right after signup, before the
// post-signup prompt has been filled in).
export function getInitials(session: Session, fullName: string | null | undefined): string {
  if (fullName && fullName.trim().length > 0) {
    const parts = fullName.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    const initials = (first + last).toUpperCase();
    if (initials) return initials;
  }

  const localPart = session.user.email?.split('@')[0] ?? '';
  return localPart.slice(0, 2).toUpperCase() || '?';
}
