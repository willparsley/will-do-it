'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ensureReminderPreferences } from '@/lib/reminder-preferences';

export function ReminderPreferences({ userId }: { userId: string }) {
  const [time, setTime] = useState('09:00');
  const [timezone, setTimezone] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await ensureReminderPreferences(userId);
        const { data, error } = await createClient().from('reminder_preferences')
          .select('default_reminder_time, timezone').eq('user_id', userId).single();
        if (error || !data) throw new Error('Could not load reminder preferences. Refresh to try again.');
        if (active) { setTime(data.default_reminder_time.slice(0, 5)); setTimezone(data.timezone); setLoaded(true); }
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : 'Could not load reminder preferences.'); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [userId]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setMessage('Choose a valid reminder time.'); return; }
    setBusy(true); setMessage('');
    try {
      const { error } = await createClient().from('reminder_preferences').upsert({
        user_id: userId, default_reminder_time: time, timezone,
      }, { onConflict: 'user_id' });
      if (error) throw new Error('Could not save reminder preferences. Please try again.');
      setMessage('Reminder preferences saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save reminder preferences.'); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="reminder-settings-heading" className="rounded-xl border border-line bg-surface p-6 mt-6">
    <h2 id="reminder-settings-heading" className="font-semibold mb-3">Reminder preferences</h2>
    <p id="default-reminder-help" className="text-sm text-ink-soft mb-4">Dates without a time notify at 9:00 AM by default. Choose another time below. This applies across your devices; explicit times, card generation, and automatic promotion stay unchanged.</p>
    <form onSubmit={event => void save(event)} className="flex flex-col items-start gap-3">
      <label htmlFor="default-reminder-time" className="field-label">Default reminder time</label>
      <input id="default-reminder-time" type="time" required step="60" value={time} disabled={busy || !loaded}
        aria-describedby="default-reminder-help reminder-timezone" onChange={event => setTime(event.target.value)} className="control min-h-11" />
      <p id="reminder-timezone" className="text-sm text-ink-soft">{timezone ? `Timezone: ${timezone}. Recurring cards use their recurrence timezone.` : 'Loading timezone…'}</p>
      <button type="submit" className="btn btn-primary min-h-11" disabled={busy || !loaded}>{busy ? 'Please wait…' : 'Save reminder preferences'}</button>
    </form>
    <p role="status" className="text-sm mt-3">{message}</p>
  </section>;
}
