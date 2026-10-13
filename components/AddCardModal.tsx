'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, CardStatus, STATUS_LABELS } from '@/lib/types';
import { toast } from 'sonner';

const supabase = createClient();

interface AddCardModalProps {
  streams: Stream[];
  onClose: () => void;
  onCardCreated: (card: any) => void;
  defaultStreamId?: string;
}

export function AddCardModal({ streams, onClose, onCardCreated, defaultStreamId }: AddCardModalProps) {
  const [title, setTitle] = useState('');
  const [streamId, setStreamId] = useState(defaultStreamId || (streams[0]?.id ?? ''));
  const [status, setStatus] = useState<CardStatus>('regular_backlog');
  const [dueAt, setDueAt] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [stackMissed, setStackMissed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !streamId) return;

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let recurrenceSourceId = null;

      if (isRecurring) {
        // Create recurrence source
        const { data: recurrence, error: recError } = await supabase
          .from('recurrence_sources')
          .insert({
            user_id: user.id,
            stream_id: streamId,
            base_title: title.trim(),
            frequency: 'daily', // default for MVP
            stack_missed: stackMissed,
          })
          .select()
          .single();

        if (recError) throw recError;
        recurrenceSourceId = recurrence.id;
      }

      const newCard = {
        user_id: user.id,
        stream_id: streamId,
        title: title.trim(),
        status,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        remind_at: remindAt ? new Date(remindAt).toISOString() : null,
        is_recurring: isRecurring,
        recurrence_source_id: recurrenceSourceId,
        position: 0, // will be adjusted by backend or client
      };

      const { data: card, error } = await supabase
        .from('cards')
        .insert(newCard)
        .select()
        .single();

      if (error) throw error;

      onCardCreated(card);
      toast.success('Card created');
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to create card');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md p-6" 
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4">Add New Card</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              placeholder="What needs to be done?"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Stream</label>
              <select 
                value={streamId} 
                onChange={(e) => setStreamId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              >
                {streams.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select 
                value={status} 
                onChange={(e) => setStatus(e.target.value as CardStatus)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              >
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Due Date</label>
              <input 
                type="datetime-local" 
                value={dueAt} 
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Remind Me At</label>
              <input 
                type="datetime-local" 
                value={remindAt} 
                onChange={(e) => setRemindAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input 
                type="checkbox" 
                checked={isRecurring} 
                onChange={(e) => setIsRecurring(e.target.checked)} 
              />
              Recurring task
            </label>

            {isRecurring && (
              <label className="flex items-center gap-2 text-sm">
                <input 
                  type="checkbox" 
                  checked={stackMissed} 
                  onChange={(e) => setStackMissed(e.target.checked)} 
                />
                Stack missed occurrences
              </label>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={loading || !title.trim()}
              className="flex-1 py-2.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 font-medium disabled:opacity-60"
            >
              {loading ? 'Creating...' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
