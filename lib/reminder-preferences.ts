import { createClient } from '@/lib/supabase/client';

/** First-use insert preserves an existing account preference on other devices. */
export async function ensureReminderPreferences(userId: string) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { error } = await createClient().from('reminder_preferences').upsert(
    { user_id: userId, timezone }, { onConflict: 'user_id', ignoreDuplicates: true },
  );
  if (error) throw new Error('Could not load reminder preferences. Please try again.');
}
