'use client';

import { CardFormDialog, CardFormCancel, cardFields, cardFormStyles as styles } from './CardForm';

import React, { useState } from 'react';
import { CardPrerequisiteField } from './CardPrerequisiteField';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, CardStatus, streamsForSelect, UNCATEGORIZED_TITLE } from '@/lib/types';
import { toast } from 'sonner';
import { dateTimeLocal, dateTimeInstant } from '@/lib/dates';
import { errorMessage } from '@/lib/errors';

const supabase = createClient();

interface EditCardModalProps {
  card: Card;
  streams: Stream[];
  cards?: Card[];
  onClose: () => void;
  onCardUpdated: (updatedCard: Card) => void;
  onCardDeleted: (cardId: string) => void;
  onEditRecurrence?: (sourceId: string) => void;
}

export function EditCardModal({ cards = [], card, streams, onClose, onCardUpdated, onCardDeleted, onEditRecurrence }: EditCardModalProps) {
  // Active streams only, alphabetical, "Uncategorized" last — but always keep
  // the card's current stream selectable, even if it's complete/canceled.
  const selectableStreams = React.useMemo(() => {
    const active = streamsForSelect(streams);
    const current = streams.find((s) => s.id === (card.recurrence_stream_id || card.stream_id));
    if (!current || active.some((s) => s.id === current.id)) return active;

    const uncIndex = active.findIndex((s) => s.title === UNCATEGORIZED_TITLE);
    if (uncIndex === -1) return [...active, current];
    return [...active.slice(0, uncIndex), current, ...active.slice(uncIndex)];
  }, [streams, card.stream_id, card.recurrence_stream_id]);

  const [title, setTitle] = useState(card.title);
  const [streamId, setStreamId] = useState(card.recurrence_stream_id || card.stream_id);
  const [status, setStatus] = useState<CardStatus>(card.status);
  const [dueAt, setDueAt] = useState(dateTimeLocal(card.due_at));
  const [remindAt, setRemindAt] = useState(dateTimeLocal(card.remind_at));
  const [prerequisiteId, setPrerequisiteId] = useState(card.prerequisite_card_id || '');
  const [notes, setNotes] = useState(card.notes || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading || !title.trim()) return;

    setLoading(true);
    setError('');

    try {
      const updates = {
        prerequisite_card_id: prerequisiteId || null,
        title: title.trim(),
        stream_id: streamId,
        status,
        due_at: dateTimeInstant(dueAt, card.due_at),
        remind_at: dateTimeInstant(remindAt, card.remind_at),
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
    } catch (err: unknown) {
      console.error(err);
      setError(errorMessage(err, 'Failed to update card'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (loading) return;
    if (cards.some(other => other.prerequisite_card_id === card.id)) {
      setError('Another card uses this as a prerequisite. Remove that link before deleting this card.');
      return;
    }
    if (!confirm('Delete this card? This cannot be undone.')) return;

    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.from('cards').delete().eq('id', card.id);
      if (error) throw error;

      onCardDeleted(card.id);
      toast.success('Card deleted');
      onClose();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete'));
    } finally {
      setLoading(false);
    }
  };

  const dirty = prerequisiteId !== (card.prerequisite_card_id || '') || title !== card.title || streamId !== (card.recurrence_stream_id || card.stream_id)
    || status !== card.status || dueAt !== dateTimeLocal(card.due_at)
    || remindAt !== dateTimeLocal(card.remind_at) || notes !== (card.notes || '');

  const editRecurrence = () => {
    if (loading || !card.recurrence_source_id || !onEditRecurrence) return;
    if (dirty && !confirm('Discard unsaved card changes and edit the recurrence?')) return;
    onEditRecurrence(card.recurrence_source_id);
  };

  return (
    <CardFormDialog title="Edit Card" dirty={dirty} saving={loading} onClose={onClose}>
      <form onSubmit={handleSave} className={styles.form}>
        <div className={styles.body}>
          <fieldset disabled={loading} className={styles.fields}>
            {cardFields({ title, setTitle, streamId, setStreamId, status, setStatus, streams: selectableStreams, saving: loading, dueAt, setDueAt, remindAt, setRemindAt, notes, setNotes, recurring: !!card.recurrence_source_id,
              datesInitiallyOpen: !!(card.due_at || card.remind_at), notesInitiallyOpen: !!card.notes })}
            <CardPrerequisiteField cards={cards} streams={streams} cardId={card.id} value={prerequisiteId} onChange={setPrerequisiteId} disabled={loading} />
            {card.recurrence_source_id && <section className={styles.section} aria-label="Recurrence">
              <div className="p-4 space-y-3">
                <h3 className="text-sm font-medium text-ink">Part of a recurring task</h3>
                {card.recurrence_title && <p className="text-sm text-ink-soft">{card.recurrence_title}</p>}
                <p className={styles.help}>Title, notes, dates, and status edits apply to this occurrence. To change the repeating title or schedule for pending and future cards, edit the recurrence.</p>
                {onEditRecurrence && <button type="button" className="btn btn-secondary focus-ring px-4 py-2.5" disabled={loading} onClick={editRecurrence}>Edit recurrence</button>}
              </div>
            </section>}
          </fieldset>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <footer className={styles.footer}>
          <button type="button" onClick={handleDelete} disabled={loading} className={`btn btn-ghost focus-ring px-2 py-2.5 ${styles.delete}`}>Delete Card</button>
          <CardFormCancel disabled={loading} />
          <button type="submit" disabled={loading || !title.trim()} className="btn btn-primary focus-ring px-5 py-2.5">{loading ? 'Saving...' : 'Save Changes'}</button>
        </footer>
      </form>
    </CardFormDialog>
  );
}
