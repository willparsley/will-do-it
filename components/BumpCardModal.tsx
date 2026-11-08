'use client';

import { useState } from 'react';
import { AppSelect } from './AppSelect';
import { CardFormDialog, CardFormCancel, cardFormStyles as styles } from './CardForm';
import type { Card } from '@/lib/types';
import { errorMessage } from '@/lib/errors';

export type BumpUnit = 'days' | 'weeks' | 'months';

export function BumpCardModal({ card, onBump, onClose }: {
  card: Card; onBump: (amount: number, unit: BumpUnit) => Promise<void>; onClose: () => void;
}) {
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<BumpUnit>('weeks');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const valid = /^\d+$/.test(amount) && Number(amount) >= 1 && Number(amount) <= 3650;
  return <CardFormDialog title="Bump due date" dirty={false} saving={saving} onClose={onClose}>
    <form className={styles.form} onSubmit={async event => {
      event.preventDefault();
      if (saving || !valid) return;
      setSaving(true); setError('');
      try { await onBump(Number(amount), unit); onClose(); }
      catch (error) { setError(errorMessage(error, 'Could not bump card')); }
      finally { setSaving(false); }
    }}>
      <div className={`${styles.body} space-y-4`}>
        <p className="text-sm text-ink break-words">{card.title}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick bump amounts">
          {(['days', 'weeks', 'months'] as const).map(value => <button key={value} type="button" disabled={saving}
            className="btn btn-secondary focus-ring min-h-11 px-3" aria-pressed={amount === '1' && unit === value}
            onClick={() => { setAmount('1'); setUnit(value); }}>1 {value.slice(0, -1)}</button>)}
        </div>
        <div>
          <label htmlFor="bump-amount" className="field-label">Bump by</label>
          <input id="bump-amount" className="control mb-2" type="number" min="1" max="3650" step="1"
            value={amount} onChange={event => setAmount(event.target.value)} required disabled={saving} />
          <AppSelect aria-label="Bump unit" value={unit} onValueChange={value => setUnit(value as BumpUnit)} disabled={saving}
            options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]} />
        </div>
        <p className={styles.help}>Adds time to the due date, or today if overdue, and returns this card to Backlog (Priority Backlog if that was its origin). It will return to Waiting on its new due or reminder day. Months clamp to the last day when needed.</p>
        {card.remind_at && <p className={styles.help}>The reminder moves by the same number of calendar days. If it would still be today or earlier, it moves to the new due date.</p>}
        {card.recurrence_source_id && <p className={styles.help}>Only this occurrence moves. Non-stacking repeats wait until it is completed or canceled; stacking repeats keep their calendar schedule.</p>}
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <footer className={styles.footer}><CardFormCancel disabled={saving} /><button type="submit" disabled={saving || !valid} className="btn btn-primary focus-ring min-h-11 px-5">{saving ? 'Bumping…' : 'Bump card'}</button></footer>
    </form>
  </CardFormDialog>;
}
