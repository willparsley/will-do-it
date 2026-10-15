'use client';

import { AppSelect } from '@/components/AppSelect';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MONTH_DAY_OPTIONS, monthDayLabel, RecurrenceSource, Stream, streamsForDisplay } from '@/lib/types';
import { calendarDay } from '@/lib/card-views';
import { errorMessage } from '@/lib/errors';
import { toast } from 'sonner';

const supabase = createClient();

function dialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  } else if (event.key === 'Tab') {
    const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) event.preventDefault();
    else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
}

interface EditRecurrenceModalProps {
  sourceId: string;
  streams: Stream[];
  onClose: () => void;
  onRecurrenceUpdated: (source: RecurrenceSource) => void;
}

export function EditRecurrenceModal({ sourceId, streams, onClose, onRecurrenceUpdated }: EditRecurrenceModalProps) {
  const [source, setSource] = useState<RecurrenceSource | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let canceled = false;
    async function load() {
      setError('');
      setSource(null);
      try {
        const { data, error } = await supabase.from('recurrence_sources').select('*').eq('id', sourceId).single<RecurrenceSource>();
        if (error) throw error;
        if (!data) throw new Error('Recurrence source not found');
        if (!canceled) setSource(data);
      } catch (error) {
        if (!canceled) setError(errorMessage(error, 'Could not load this recurrence'));
      }
    }
    void load();
    return () => { canceled = true; };
  }, [sourceId, attempt]);

  if (source) return <RecurrenceForm key={source.id} source={source} streams={streams} onClose={onClose} onRecurrenceUpdated={onRecurrenceUpdated} />;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="recurrence-loading-title" className="modal-panel max-w-md p-6" onClick={e => e.stopPropagation()} onKeyDown={event => dialogKeyDown(event, onClose)}>
        <h2 id="recurrence-loading-title" className="text-xl font-semibold text-ink">Edit Recurrence</h2>
        <p className="my-4 text-sm text-ink-soft" role={error ? 'alert' : 'status'}>{error || 'Loading recurrence…'}</p>
        <div className="flex gap-3">
          <button type="button" className="btn btn-secondary px-4 py-2" onClick={onClose} autoFocus>Close</button>
          {error && <button type="button" className="btn btn-primary px-4 py-2" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
        </div>
      </div>
    </div>
  );
}

interface RecurrenceFormProps extends Omit<EditRecurrenceModalProps, 'sourceId'> {
  source: RecurrenceSource;
}

export function RecurrenceForm({ source, streams, onClose, onRecurrenceUpdated }: RecurrenceFormProps) {
  const [title, setTitle] = useState(source.base_title);
  const [streamId, setStreamId] = useState(source.stream_id);
  const [frequency, setFrequency] = useState(source.frequency || 'daily');
  const [interval, setInterval] = useState(source.interval || 1);
  const [weekdays, setWeekdays] = useState<number[]>(source.weekdays || []);
  const [monthDay, setMonthDay] = useState(source.month_day || (source.created_at
    ? Number(calendarDay(source.created_at, source.recurrence_timezone || undefined).slice(8)) : 1));
  const [stackMissed, setStackMissed] = useState(!!source.stack_missed);
  const [endDate, setEndDate] = useState(source.end_date ? calendarDay(source.end_date, source.recurrence_timezone || undefined) : '');
  const [enabled, setEnabled] = useState(!source.stopped_at);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selectableStreams = streamsForDisplay(streams.filter(stream => stream.state === 'in_progress' || stream.id === source.stream_id));
  const timezone = source.recurrence_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const close = () => { if (!saving) onClose(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const { data, error } = await supabase.rpc('save_recurrence', {
        p_source_id: source.id,
        p_expected_updated_at: source.updated_at || null,
        p_timezone: timezone,
        p_changes: {
          base_title: title.trim(), stream_id: streamId, frequency,
          interval: frequency === 'daily' ? 1 : interval,
          weekdays: frequency === 'weekly' ? weekdays : null,
          month_day: frequency === 'monthly' ? monthDay : null,
          stack_missed: stackMissed, end_date: endDate || null, enabled,
        },
      }).single<RecurrenceSource>();
      if (error) throw error;
      if (!data) throw new Error('Could not save this recurrence');
      onRecurrenceUpdated(data);
      toast.success('Recurrence updated');
      onClose();
    } catch (error) {
      setError(errorMessage(error, 'Could not save this recurrence'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="recurrence-title" aria-describedby="recurrence-description" className="modal-panel max-w-md p-6 max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()} onKeyDown={event => dialogKeyDown(event, close)}>
        <h2 id="recurrence-title" className="text-xl font-semibold text-ink">Edit Recurrence</h2>
        <p id="recurrence-description" className="mt-2 mb-4 text-sm text-ink-soft">Changes update pending cards and future occurrences. Completed and canceled cards stay unchanged. Only automatically promoted Waiting cards return to backlog when their dates move into the future.</p>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={saving} className="space-y-4">
            <div>
              <label htmlFor="recurrence-base-title" className="field-label">Title</label>
              <input id="recurrence-base-title" className="control" value={title} onChange={e => setTitle(e.target.value)} required autoFocus />
            </div>
            <div>
              <label htmlFor="recurrence-stream" className="field-label">Stream</label>
              <AppSelect
                id="recurrence-stream"
                className="w-full"
                value={streamId}
                onValueChange={value => setStreamId(value)}
                aria-label="Stream"
                disabled={saving}
                options={selectableStreams.map(stream => ({ value: stream.id, label: stream.title + (stream.state !== 'in_progress' ? ' (closed)' : '') }))}
              />
              <p className="mt-1 text-xs text-ink-muted">Moving the recurrence also moves its pending cards.</p>
            </div>
            <div>
              <label htmlFor="recurrence-frequency" className="field-label">Repeat</label>
              <AppSelect
                id="recurrence-frequency"
                className="w-full"
                value={frequency}
                onValueChange={value => setFrequency(value)}
                aria-label="Repeat"
                disabled={saving}
                options={[{ value: 'daily', label: 'Daily' }, { value: 'every_n_days', label: 'Every N days' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]}
              />
            </div>
            {frequency !== 'daily' && (
              <div>
                <label htmlFor="recurrence-interval" className="field-label">Every {frequency === 'weekly' ? 'N weeks' : frequency === 'monthly' ? 'N months' : 'N days'}</label>
                <input id="recurrence-interval" type="number" min={1} step={1} required className="control" value={interval} onChange={e => setInterval(Math.max(1, parseInt(e.target.value, 10) || 1))} />
              </div>
            )}
            {frequency === 'weekly' && (
              <fieldset>
                <legend className="field-label">On weekdays</legend>
                <div className="flex flex-wrap gap-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                    <label key={day} className={`flex items-center gap-1 rounded border px-2 py-1 text-sm cursor-pointer ${weekdays.includes(index) ? 'bg-accent-soft border-accent text-ink' : 'border-line text-ink-soft'}`}>
                      <input type="checkbox" checked={weekdays.includes(index)} onChange={e => setWeekdays(previous => e.target.checked ? [...previous, index].sort() : previous.filter(value => value !== index))} />{day}
                    </label>
                  ))}
                </div>
                {weekdays.length === 0 && <p className="mt-1 text-xs text-ink-muted">With no days selected, repeats on the weekday this recurrence was created.</p>}
              </fieldset>
            )}
            {frequency === 'monthly' && (
              <div>
                <label htmlFor="recurrence-month-day" className="field-label">Day of month</label>
                <AppSelect
                  id="recurrence-month-day"
                  className="w-full"
                  value={String(monthDay)}
                  onValueChange={value => setMonthDay(Number(value))}
                  aria-label="Day of month"
                  disabled={saving}
                  options={MONTH_DAY_OPTIONS.map(day => ({ value: String(day), label: monthDayLabel(day) }))}
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={stackMissed} onChange={e => setStackMissed(e.target.checked)} />Stack missed occurrences
            </label>
            <p className="text-xs text-ink-muted">Turn off stacking after completing or canceling any extra pending occurrences. Changing patterns reschedules existing pending cards in order.</p>
            <div>
              <label htmlFor="recurrence-end-date" className="field-label">End date (optional)</label>
              <input id="recurrence-end-date" type="date" className="control" value={endDate} onChange={e => setEndDate(e.target.value)} />
              <p className="mt-1 text-xs text-ink-muted">Dates use {timezone}. The end date limits new occurrences; existing cards are retained.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Generate future occurrences
            </label>
            {!enabled && <p className="text-xs text-ink-muted">Recurrence is stopped. Pending cards are retained.</p>}
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn btn-secondary flex-1 py-2.5" onClick={close} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary flex-1 py-2.5" disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save Recurrence'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
