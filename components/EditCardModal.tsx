'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, CardStatus, STATUS_LABELS } from '@/lib/types';
import { toast } from 'sonner';

const supabase = createClient();

interface EditCardModalProps {
  card: Card;
  streams: Stream[];
  onClose: () => void;
  onCardUpdated: (updatedCard: Card) => void;
  onCardDeleted: (cardId: string) => void;
}

export function EditCardModal({ card, streams, onClose, onCardUpdated, onCardDeleted }: EditCardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [streamId, setStreamId] = useState(card.stream_id);
  const [status, setStatus] = useState<CardStatus>(card.status);
  const [dueAt, setDueAt] = useState(card.due_at ? card.due_at.slice(0, 16) : '');
  const [remindAt, setRemindAt] = useState(card.remind_at ? card.remind_at.slice(0, 16) : '');
  const [notes, setNotes] = useState(card.notes || '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;

    setLoading(true);

    try {
      const updates: any = {
        title: title.trim(),
        stream_id: streamId,
        status,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        remind_at: remindAt ? new Date(remindAt).toISOString() : null,
        notes: notes.trim() || null,
      };

      const { data: updatedCard, error } = await supabase
        .from('cards')
        .update(updates)
        .eq('id', card.id)
        .select()
        .single();

      if (error) throw error;

      // If stream changed and this is recurring, update the source
      if (streamId !== card.stream_id && card.is_recurring && card.recurrence_source_id) {
        await supabase
          .from('recurrence_sources')
          .update({ stream_id: streamId })
          .eq('id', card.recurrence_source_id);
      }

      onCardUpdated(updatedCard);
      toast.success('Card updated');
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update card');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this card? This cannot be undone.')) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('cards').delete().eq('id', card.id);
      if (error) throw error;

      onCardDeleted(card.id);
      toast.success('Card deleted');
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = (newStatus: CardStatus) => {
    setStatus(newStatus);
    // Auto set completed_at if moving to complete/canceled
    if ((newStatus === 'complete' || newStatus === 'canceled') && !card.completed_at) {
      // We don't set it here, the backend or a trigger could, but for now we can leave it
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-auto" 
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4">Edit Card</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              required
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
                onChange={(e) => handleStatusChange(e.target.value as CardStatus)}
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

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              placeholder="Optional notes..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              disabled={loading}
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              disabled={loading || !title.trim()}
              className="flex-1 py-2.5 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-950 font-medium disabled:opacity-60"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          <button 
            onClick={handleDelete}
            disabled={loading}
            className="w-full text-sm text-red-600 hover:text-red-700 dark:text-red-400 py-2"
          >
            Delete Card
          </button>
        </div>
      </div>
    </div>
  );
}
