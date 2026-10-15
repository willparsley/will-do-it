'use client';

import { CardFormDialog, CardFormCancel, cardFields, cardFormStyles as styles } from './CardForm';
import { AppSelect } from '@/components/AppSelect';

import React, { useState } from 'react';
import { CardPrerequisiteField } from './CardPrerequisiteField';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, CardStatus, streamsForSelect, uncategorizedId, MONTH_DAY_OPTIONS, monthDayLabel } from '@/lib/types';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';

const supabase = createClient();

interface AddCardModalProps {
  streams: Stream[];
  cards?: Card[];
  onClose: () => void;
  onCardCreated: (card: Card) => void;
  defaultStreamId?: string;
}

export function AddCardModal({ cards = [], streams, onClose, onCardCreated, defaultStreamId }: AddCardModalProps) {
  // Only active streams, alphabetical, "Uncategorized" last.
  const selectableStreams = React.useMemo(() => streamsForSelect(streams), [streams]);

  const [title, setTitle] = useState('');
  const [streamId, setStreamId] = useState(
    () => defaultStreamId || uncategorizedId(selectableStreams) || selectableStreams[0]?.id || ''
  );
  const [status, setStatus] = useState<CardStatus>('backlog');
  const [dueAt, setDueAt] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [stackMissed, setStackMissed] = useState(false);
  const [frequency, setFrequency] = useState<'daily' | 'every_n_days' | 'weekly' | 'monthly'>('daily');
  const [recInterval, setRecInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([]); // 0=Sun, 1=Mon, ..., 6=Sat
  const [monthDay, setMonthDay] = useState(1); // 1..31, or -1 for the last day
  const [prerequisiteId, setPrerequisiteId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !title.trim() || !streamId) return;

    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const due = dueAt ? new Date(dueAt).toISOString() : null;
      const reminder = remindAt ? new Date(remindAt).toISOString() : null;
      const result = isRecurring
        ? await supabase.rpc('create_recurring_card_with_prerequisite', {
            p_prerequisite_card_id: prerequisiteId || null,
            p_notes: notes.trim() || null, p_title: title.trim(), p_stream_id: streamId, p_status: status,
            p_due_at: due, p_remind_at: reminder,
            p_frequency: frequency, p_interval: frequency === 'daily' ? 1 : recInterval,
            p_weekdays: frequency === 'weekly' ? weekdays : null,
            p_month_day: frequency === 'monthly' ? monthDay : null,
            p_stack_missed: stackMissed,
            p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }).single<Card>()
        : await supabase.from('cards').insert({
            prerequisite_card_id: prerequisiteId || null,
            user_id: user.id, stream_id: streamId, title: title.trim(), status,
            notes: notes.trim() || null, due_at: due, remind_at: reminder, is_recurring: false, position: 0,
          }).select().single<Card>();
      const { data: card, error } = result;
      if (error) throw error;

      onCardCreated(card);
      toast.success('Card created');
      onClose();
    } catch (err: unknown) {
      console.error(err);
      setError(errorMessage(err, 'Failed to create card'));
    } finally {
      setLoading(false);
    }
  };

  const initialStreamId = defaultStreamId || uncategorizedId(selectableStreams) || selectableStreams[0]?.id || '';
  const dirty = !!(prerequisiteId || title || notes || dueAt || remindAt || isRecurring || stackMissed || frequency !== 'daily' || recInterval !== 1 || weekdays.length || monthDay !== 1 || streamId !== initialStreamId || status !== 'backlog');

  return (
    <CardFormDialog title="Add New Card" dirty={dirty} saving={loading} onClose={onClose}>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.body}>
          <fieldset disabled={loading} className={styles.fields}>
            {cardFields({ title, setTitle, streamId, setStreamId, status, setStatus, streams: selectableStreams, saving: loading, dueAt, setDueAt, remindAt, setRemindAt, notes, setNotes })}
            <CardPrerequisiteField cards={cards} streams={streams} value={prerequisiteId} onChange={setPrerequisiteId} disabled={loading} />
            <details className={styles.section} open={isRecurring}>
              <summary className="focus-ring" aria-disabled={loading} onClick={event => {
                event.preventDefault();
                if (!loading) setIsRecurring(previous => !previous);
              }}>Repeat <span className={styles.optional}>{isRecurring ? 'Recurring' : 'Does not repeat'}</span></summary>
              <div className={styles.sectionBody}>
                {isRecurring && <>
                  <div>
                    <label htmlFor="card-frequency" className="field-label">Repeat</label>
                    <AppSelect id="card-frequency" value={frequency} onValueChange={value => setFrequency(value as typeof frequency)} aria-label="Repeat" disabled={loading}
                      options={[{ value: 'daily', label: 'Daily' }, { value: 'every_n_days', label: 'Every N days' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />
                  </div>
                  {frequency !== 'daily' && <div>
                    <label htmlFor="card-interval" className="field-label">Every {frequency === 'weekly' ? 'N weeks' : frequency === 'monthly' ? 'N months' : 'N days'}</label>
                    <input id="card-interval" type="number" min={1} step={1} required value={recInterval} onChange={e => setRecInterval(Math.max(1, parseInt(e.target.value, 10) || 1))} className="control" />
                  </div>}
                  {frequency === 'weekly' && <fieldset>
                    <legend className="field-label">On weekdays</legend>
                    <div className={styles.weekdays}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <label key={day} className={styles.weekday}>
                        <input type="checkbox" aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]} checked={weekdays.includes(index)}
                          onChange={e => setWeekdays(previous => e.target.checked ? [...previous, index].sort() : previous.filter(value => value !== index))} />{day}
                      </label>)}
                    </div>
                    {!weekdays.length && <p className={styles.help}>With no days selected, repeats on today’s weekday.</p>}
                  </fieldset>}
                  {frequency === 'monthly' && <div>
                    <label htmlFor="card-month-day" className="field-label">Day of month</label>
                    <AppSelect id="card-month-day" value={String(monthDay)} onValueChange={value => setMonthDay(Number(value))} aria-label="Day of month" disabled={loading}
                      options={MONTH_DAY_OPTIONS.map(day => ({ value: String(day), label: monthDayLabel(day) }))} />
                  </div>}
                  <div>
                    <label className={styles.check}><input type="checkbox" checked={stackMissed} onChange={e => setStackMissed(e.target.checked)} aria-describedby="card-stack-help" />Keep missed occurrences</label>
                    <p id="card-stack-help" className={styles.help}>{stackMissed ? 'Each missed occurrence stays as a separate card.' : 'Keep just one pending occurrence until you complete or cancel it.'}</p>
                  </div>
                  <p className={styles.help}>Close Repeat to make this a one-off card. Without a due date, the first occurrence starts on the next matching day, including today. Notes apply to this first card. You can change the schedule or set an end date after creation.</p>
                </>}
              </div>
            </details>
          </fieldset>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <footer className={styles.footer}>
          <CardFormCancel disabled={loading} />
          <button type="submit" disabled={loading || !title.trim() || !streamId} className="btn btn-primary focus-ring px-5 py-2.5">{loading ? 'Creating...' : 'Create Card'}</button>
        </footer>
      </form>
    </CardFormDialog>
  );
}
