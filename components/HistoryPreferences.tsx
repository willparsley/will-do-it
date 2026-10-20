'use client';

import { useState } from 'react';
import { readHistoryLimit, saveHistoryLimit, type HistoryLimit } from '@/lib/history-preferences';

export function HistoryPreferences({ userId }: { userId: string }) {
  const [value, setValue] = useState(() => String(readHistoryLimit(userId)));
  const [message, setMessage] = useState('');

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limit: HistoryLimit = value === 'all' ? 'all' : Number(value);
    if (limit !== 'all' && (!Number.isSafeInteger(limit) || limit < 1)) {
      setMessage('Enter a positive whole number, or choose All.');
      return;
    }
    setMessage(saveHistoryLimit(userId, limit) ? 'History preferences saved.' : 'Could not save. Browser storage is unavailable.');
  }

  return <section aria-labelledby="history-settings-heading" className="rounded-xl border border-line bg-surface p-6 mt-6">
    <h2 id="history-settings-heading" className="font-semibold mb-3">Completed history</h2>
    <p id="history-limit-help" className="text-sm text-ink-soft mb-4">Show the newest 5 entries by default in each stream’s Complete and Canceled lists. Expand any list to see all entries in the selected history period. Recurring groups count as one entry; their expanded occurrences use the same limit. This preference is saved for your account in this browser.</p>
    <form onSubmit={save} className="flex flex-col items-start gap-3">
      <label htmlFor="history-limit" className="field-label">Entries shown by default</label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="History presets">
        {[3, 5, 10, 'all'].map(preset => <button key={preset} type="button" aria-pressed={value === String(preset)} className={`btn ${value === String(preset) ? 'btn-primary' : 'btn-secondary'} focus-ring min-h-11 px-4`} onClick={() => { setValue(String(preset)); setMessage(''); }}>{preset === 'all' ? 'All' : preset}</button>)}
      </div>
      <input id="history-limit" type="number" min="1" step="1" required={value !== 'all'} disabled={value === 'all'} value={value === 'all' ? '' : value} placeholder={value === 'all' ? 'All entries' : 'Custom number'} aria-describedby="history-limit-help" className="control min-h-11 w-full sm:w-40" onChange={event => { setValue(event.target.value); setMessage(''); }} />
      {value === 'all' && <button type="button" className="btn btn-ghost focus-ring min-h-11 px-3" onClick={() => setValue('5')}>Use a number</button>}
      <button type="submit" className="btn btn-primary focus-ring min-h-11 w-full px-5 py-2.5 text-sm sm:w-auto">Save history preferences</button>
    </form>
    <p role="status" className="text-sm mt-3">{message}</p>
  </section>;
}
