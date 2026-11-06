'use client';

import { useState } from 'react';
import { readLaterDays, saveLaterDays } from '@/lib/later-preferences';

export function LaterPreferences({ userId }: { userId: string }) {
  const [value, setValue] = useState(() => String(readLaterDays(userId)));
  const [message, setMessage] = useState('');
  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const days = Number(value);
    if (!value.trim() || !Number.isSafeInteger(days) || days < 0 || days > 3650) {
      setMessage('Enter a whole number from 0 to 3650.');
      return;
    }
    setMessage(saveLaterDays(userId, days) ? 'Later preferences saved.' : 'Could not save. Browser storage is unavailable.');
  }
  return <section aria-labelledby="later-settings-heading" className="rounded-xl border border-line bg-surface p-6 mt-6">
    <h2 id="later-settings-heading" className="font-semibold mb-3">Future backlog cards</h2>
    <p id="later-days-help" className="text-sm text-ink-soft mb-4">Keep distant cards in a collapsed Later group in Backlog and Priority Backlog. Cards become visible this many days before their due date or an earlier reminder. This applies to recurring and ordinary cards; undated cards stay visible. The default is 3 days. This preference is saved for your account in this browser.</p>
    <form onSubmit={save} className="flex flex-col items-start gap-3">
      <label htmlFor="later-days" className="field-label">Show cards this many days ahead</label>
      <input id="later-days" type="number" min="0" max="3650" step="1" required value={value} aria-describedby="later-days-help" className="control min-h-11 w-full sm:w-40" onChange={event => { setValue(event.target.value); setMessage(''); }} />
      <p className="text-xs text-ink-soft">Use 0 to show dated cards on their due or reminder day.</p>
      <button type="submit" className="btn btn-primary focus-ring min-h-11 w-full px-5 py-2.5 text-sm sm:w-auto">Save Later preferences</button>
    </form>
    <p role="status" className="text-sm mt-3">{message}</p>
  </section>;
}
