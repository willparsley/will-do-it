import type { SupabaseClient } from '@supabase/supabase-js';

/** Watches identity changes without network requests or reacting to token refreshes. */
export function watchAccount(client: SupabaseClient, onInvalidate: (signedOut: boolean) => void) {
  let userId: string | undefined;
  let active = true;
  const invalidate = (signedOut: boolean) => {
    if (!active) return;
    active = false;
    onInvalidate(signedOut);
  };
  // Subscribe before getUser() so logout cannot race the initial load.
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') invalidate(true);
    else if (session?.user) {
      if (userId !== undefined && session.user.id !== userId) invalidate(false);
      else userId = session.user.id;
    }
  });
  return {
    acceptUser(id: string) {
      if (!active) return false;
      if (userId !== undefined && userId !== id) {
        invalidate(false);
        return false;
      }
      userId = id;
      return true;
    },
    get active() { return active; },
    dispose() {
      active = false;
      subscription.unsubscribe();
    },
  };
}
