'use client';

import { useState } from 'react';
import { AppSelect } from './AppSelect';
import { CardFormDialog, CardFormCancel, cardFormStyles as styles } from './CardForm';
import { type Card, type CardStatus, type Stream, streamsForDisplay, STATUS_LABELS } from '@/lib/types';
import { displayStreamId } from '@/lib/card-views';
import { errorMessage } from '@/lib/errors';

export function MoveCardModal({ card, streams, onMove, onClose }: {
  card: Card; streams: Stream[]; onMove: (streamId: string, status: CardStatus) => Promise<void>; onClose: () => void;
}) {
  const [streamId, setStreamId] = useState(displayStreamId(card));
  const [status, setStatus] = useState<CardStatus>(card.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = streamId !== displayStreamId(card) || status !== card.status;
  const destinations = streamsForDisplay(streams.filter(stream => stream.state === 'in_progress' || stream.id === displayStreamId(card)));
  return <CardFormDialog title="Move Card" dirty={dirty} saving={saving} onClose={onClose}>
    <form className={styles.form} onSubmit={async event => {
      event.preventDefault();
      if (saving || !dirty) return;
      setSaving(true); setError('');
      try { await onMove(streamId, status); onClose(); }
      catch (error) { setError(errorMessage(error, 'Could not move card')); }
      finally { setSaving(false); }
    }}>
      <div className={`${styles.body} space-y-4`}>
        <p className="text-sm text-ink break-words">{card.title}</p>
        <AppSelect aria-label="Destination stream" value={streamId} onValueChange={setStreamId} disabled={saving} options={destinations.map(stream => ({ value: stream.id, label: stream.title }))} />
        <AppSelect aria-label="Destination status" value={status} onValueChange={value => setStatus(value as CardStatus)} disabled={saving} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        {card.recurrence_source_id && <p className={styles.help}>Moving to another stream also moves pending occurrences and sets the stream for future ones.</p>}
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <footer className={styles.footer}><CardFormCancel disabled={saving} /><button type="submit" disabled={saving || !dirty} className="btn btn-primary min-h-11 px-5">{saving ? 'Moving…' : 'Move'}</button></footer>
    </form>
  </CardFormDialog>;
}
