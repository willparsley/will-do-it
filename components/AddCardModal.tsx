'use client';

import { AppSelect } from '@/components/AppSelect';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, CardStatus, STATUS_LABELS, streamsForSelect, uncategorizedId, MONTH_DAY_OPTIONS, monthDayLabel } from '@/lib/types';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';

const supabase = createClient();

interface AddCardModalProps {
  streams: Stream[];
  onClose: () => void;
  onCardCreated: (card: Card) => void;
  defaultStreamId?: string;
}

export function AddCardModal({ streams, onClose, onCardCreated, defaultStreamId }: AddCardModalProps) {
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
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !streamId) return;

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const due = dueAt ? new Date(dueAt).toISOString() : null;
      const reminder = remindAt ? new Date(remindAt).toISOString() : null;
      const result = isRecurring
        ? await supabase.rpc('create_recurring_card', {
            p_title: title.trim(), p_stream_id: streamId, p_status: status,
            p_due_at: due, p_remind_at: reminder,
            p_frequency: frequency, p_interval: frequency === 'daily' ? 1 : recInterval,
            p_weekdays: frequency === 'weekly' ? weekdays : null,
            p_month_day: frequency === 'monthly' ? monthDay : null,
            p_stack_missed: stackMissed,
            p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }).single<Card>()
        : await supabase.from('cards').insert({
            user_id: user.id, stream_id: streamId, title: title.trim(), status,
            due_at: due, remind_at: reminder, is_recurring: false, position: 0,
          }).select().single<Card>();
      const { data: card, error } = result;
      if (error) throw error;

      onCardCreated(card);
      toast.success('Card created');
      onClose();
    } catch (err: unknown) {
      console.error(err);
      toast.error(errorMessage(err, 'Failed to create card'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div 
        className="modal-panel max-w-md p-6" 
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4 text-ink">Add New Card</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="field-label">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="control"
              placeholder="What needs to be done?"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Stream</label>
              <AppSelect
                value={streamId}
                onValueChange={value => setStreamId(value)}
                className="w-full"
                aria-label="Stream"
                disabled={loading}
                options={selectableStreams.map(s => ({ value: s.id, label: s.title }))}
              />
            </div>

            <div>
              <label className="field-label">Status</label>
              <AppSelect
                value={status}
                onValueChange={value => setStatus(value as CardStatus)}
                className="w-full"
                aria-label="Status"
                disabled={loading}
                options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Due Date</label>
              <input 
                type="datetime-local" 
                value={dueAt} 
                onChange={(e) => setDueAt(e.target.value)}
                className="control"
              />
            </div>
            <div>
              <label className="field-label">Remind Me At</label>
              <input 
                type="datetime-local" 
                value={remindAt} 
                onChange={(e) => setRemindAt(e.target.value)}
                className="control"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input 
                type="checkbox" 
                checked={isRecurring} 
                onChange={(e) => setIsRecurring(e.target.checked)} 
              />
              Recurring task
            </label>

            {isRecurring && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2 text-ink-soft">
                  <input 
                    type="checkbox" 
                    checked={stackMissed} 
                    onChange={(e) => setStackMissed(e.target.checked)} 
                  />
                  Stack
                </label>

                <AppSelect
                  value={frequency}
                  onValueChange={value => setFrequency(value as typeof frequency)}
                  className="w-auto"
                  size="compact"
                  aria-label="Repeat"
                  disabled={loading}
                  options={[{ value: 'daily', label: 'Daily' }, { value: 'every_n_days', label: 'Every N days' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Every N months' }]}
                />

                {(frequency === 'every_n_days' || frequency === 'weekly' || frequency === 'monthly') && (
                  <label className="flex items-center gap-1 text-xs text-ink-soft">
                    every
                    <input 
                      type="number" 
                      min={1} 
                      value={recInterval} 
                      onChange={(e) => setRecInterval(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-12 px-1 py-0.5 text-xs bg-surface border border-line rounded text-ink"
                    />
                    {frequency === 'every_n_days'
                      ? (recInterval === 1 ? 'day' : 'days')
                      : frequency === 'weekly' ? (recInterval === 1 ? 'week' : 'weeks')
                      : (recInterval === 1 ? 'month' : 'months')}
                  </label>
                )}

                {frequency === 'monthly' && (
                  <div className="flex items-center gap-1 text-xs text-ink-soft">
                    <span>on</span>
                    <AppSelect
                      value={String(monthDay)}
                      onValueChange={value => setMonthDay(parseInt(value, 10))}
                      className="w-auto"
                      size="compact"
                      aria-label="Day of month"
                      disabled={loading}
                      options={MONTH_DAY_OPTIONS.map(d => ({ value: String(d), label: monthDayLabel(d) }))}
                    />
                  </div>
                )}

                {frequency === 'weekly' && (
                  <div className="flex gap-1 text-[10px]">
                    {['S','M','T','W','T','F','S'].map((d, i) => (
                      <label key={i} className={`px-1 py-0.5 border rounded cursor-pointer ${weekdays.includes(i) ? 'bg-accent text-accent-ink border-accent' : 'border-line text-ink-soft'}`}>
                        <input 
                          type="checkbox" 
                          checked={weekdays.includes(i)} 
                          onChange={(e) => {
                            if (e.target.checked) setWeekdays([...weekdays, i].sort());
                            else setWeekdays(weekdays.filter(w => w !== i));
                          }} 
                          className="hidden" 
                        />
                        {d}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button 
              type="button" 
              onClick={onClose}
              className="btn btn-secondary flex-1 py-2.5"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading || !title.trim()}
              className="btn btn-primary flex-1 py-2.5"
            >
              {loading ? 'Creating...' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
