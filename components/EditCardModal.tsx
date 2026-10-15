'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, CardStatus, STATUS_LABELS, streamsForSelect, UNCATEGORIZED_TITLE } from '@/lib/types';
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
  // Active streams only, alphabetical, "Uncategorized" last — but always keep
  // the card's current stream selectable, even if it's complete/canceled.
  const selectableStreams = React.useMemo(() => {
    const active = streamsForSelect(streams);
    const current = streams.find((s) => s.id === card.stream_id);
    if (!current || active.some((s) => s.id === current.id)) return active;

    const uncIndex = active.findIndex((s) => s.title === UNCATEGORIZED_TITLE);
    if (uncIndex === -1) return [...active, current];
    return [...active.slice(0, uncIndex), current, ...active.slice(uncIndex)];
  }, [streams, card.stream_id]);

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

      const { data: updatedCard, error } = await supabase.rpc('save_card', {
        p_card_id: card.id,
        p_expected_status: card.status,
        p_changes: updates,
      }).single<Card>();
      if (error) throw error;

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
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div 
        className="modal-panel max-w-md p-6 max-h-[90vh] overflow-auto" 
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4 text-ink">Edit Card</h2>

        <div className="space-y-4">
          <div>
            <label className="field-label">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="control"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Stream</label>
              <select 
                value={streamId} 
                onChange={(e) => setStreamId(e.target.value)}
                className="control"
              >
                {selectableStreams.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label">Status</label>
              <select 
                value={status} 
                onChange={(e) => handleStatusChange(e.target.value as CardStatus)}
                className="control"
              >
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
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

          <div>
            <label className="field-label">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="control"
              placeholder="Optional notes..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button 
              type="button" 
              onClick={onClose}
              className="btn btn-secondary flex-1 py-2.5"
              disabled={loading}
            >
              Cancel
            </button>
            <button 
              onClick={handleSave}
              disabled={loading || !title.trim()}
              className="btn btn-primary flex-1 py-2.5"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          <button 
            onClick={handleDelete}
            disabled={loading}
            className="w-full text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 py-2"
          >
            Delete Card
          </button>
        </div>
      </div>
    </div>
  );
}
