'use client';

import { useState } from 'react';
import { Card, Stream, STATUS_LABELS } from '@/lib/types';
import { prerequisiteCandidates } from '@/lib/card-prerequisites';
import { AppSelect } from './AppSelect';
import { cardFormStyles as styles } from './CardForm';

export function CardPrerequisiteField({ cards, streams, cardId, value, onChange, disabled }: {
  cards: Card[];
  streams: Stream[];
  cardId?: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(!!value);
  const streamNames = new Map(streams.map(stream => [stream.id, stream.title]));
  const candidates = prerequisiteCandidates(cards, cardId);
  const selected = cards.find(card => card.id === value);
  const matching = candidates.filter(card => card.id === value || `${card.title} ${streamNames.get(card.stream_id) || ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  return <details className={styles.section} open={open}>
    <summary className="focus-ring" aria-disabled={disabled} onClick={event => {
      event.preventDefault();
      if (!disabled) setOpen(previous => !previous);
    }}>Prerequisite <span className={styles.optional}>{value ? 'Linked' : 'Optional'}</span></summary>
    <div className={styles.sectionBody}>
      <div>
        <label htmlFor="card-prerequisite-search" className="field-label">Find a card</label>
        <input id="card-prerequisite-search" type="search" value={search} onChange={event => setSearch(event.target.value)} className="control" placeholder="Search cards or streams" disabled={disabled} />
      </div>
      <div>
        <label htmlFor="card-prerequisite" className="field-label">Prerequisite card</label>
        <AppSelect id="card-prerequisite" aria-label="Prerequisite card" value={value || 'none'}
          onValueChange={id => onChange(id === 'none' ? '' : id)} disabled={disabled}
          options={[{ value: 'none', label: 'No prerequisite' },
            ...(value && !selected ? [{ value, label: 'Unavailable prerequisite' }] : []),
            ...matching.map(card => ({ value: card.id, label: `${card.title} · ${streamNames.get(card.stream_id) || 'Stream'} · ${STATUS_LABELS[card.status]}` }))]} />
      </div>
      {search && !matching.length && <p className={styles.help}>No matching cards.</p>}
      <p className={styles.help}>{selected ? selected.status === 'complete' ? `Prerequisite complete: ${selected.title}.` : `Blocked until “${selected.title}” is Complete.` : 'An unfinished prerequisite softens the card title and adds a muted red blocked label. You can still move or complete this card.'}</p>
      <p className={styles.help}>For recurring tasks, this link applies only to this occurrence.</p>
    </div>
  </details>;
}
