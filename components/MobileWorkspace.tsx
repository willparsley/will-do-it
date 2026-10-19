'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { ChevronDown, Plus, SlidersHorizontal } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { CardFormDialog } from './CardForm';
import { AreaIndicator } from './AreaIndicator';
import { ArchiveCards } from './ArchiveCards';
import { StatusHeader } from './StatusHeader';
import { type Card, type CardStatus, type Stream, STATUS_LABELS } from '@/lib/types';
import { type View, displayStreamId } from '@/lib/card-views';
import styles from './MobileWorkspace.module.css';
import menuStyles from './HeaderControls.module.css';

export type MobileLayout = 'status' | 'stream' | 'board';
export const MOBILE_LAYOUTS = [
  { value: 'status', label: 'By status' },
  { value: 'stream', label: 'By stream' },
  { value: 'board', label: 'Board' },
];

export function MobileAddMenu({ onCard, onStream }: { onCard: () => void; onStream: () => void }) {
  return <MenuTrigger>
    <Button className="btn btn-primary min-h-11 px-3 text-sm"><Plus size={18} /> Add</Button>
    <Popover placement="bottom end" className={menuStyles.popover}>
      <Menu aria-label="Add" className={menuStyles.menu}>
        <MenuItem id="card" onAction={onCard} className={menuStyles.item}>New card</MenuItem>
        <MenuItem id="stream" onAction={onStream} className={menuStyles.item}>New stream</MenuItem>
      </Menu>
    </Popover>
  </MenuTrigger>;
}

export function MobileLayoutControls({ layout, onLayout, filters, filterCount }: {
  layout: MobileLayout; onLayout: (layout: MobileLayout) => void; filters: ReactNode; filterCount: number;
}) {
  const [open, setOpen] = useState(false);
  return <div className={styles.controls}>
    <AppSelect aria-label="Mobile layout" value={layout} onValueChange={value => onLayout(value as MobileLayout)} options={MOBILE_LAYOUTS} />
    <button type="button" className="btn btn-secondary min-h-11 px-3 text-sm" onClick={() => setOpen(true)}>
      <SlidersHorizontal size={16} /> Filters{filterCount > 0 && <span className={styles.count}>{filterCount}</span>}
    </button>
    {open && <CardFormDialog title="Filters" dirty={false} saving={false} onClose={() => setOpen(false)}>
      <div className={styles.filters}>{filters}</div>
      <div className="p-4 border-t border-line flex justify-between items-center">
        <Link href="/streams" onClick={() => setOpen(false)} className="btn btn-ghost min-h-11 px-3">All streams</Link>
        <button type="button" className="btn btn-primary min-h-11 px-5" onClick={() => setOpen(false)}>Done</button>
      </div>
    </CardFormDialog>}
  </div>;
}

export function MobileCards({ layout, view, streams, columns, cardsForStream, renderCard, onAdd, onEditStream }: {
  layout: 'status' | 'stream'; view: View; streams: Stream[]; columns: CardStatus[];
  cardsForStream: (id: string) => Card[]; renderCard: (card: Card) => ReactNode;
  onAdd: (context: { streamId?: string; status: CardStatus }) => void;
  onEditStream: (stream: Stream) => void;
}) {
  const allCards = streams.flatMap(stream => cardsForStream(stream.id));
  const streamContext = (card: Card) => {
    const stream = streams.find(stream => stream.id === displayStreamId(card));
    return stream ? <span className="flex items-center gap-1.5"><AreaIndicator area={stream.area} />{stream.title}</span> : null;
  };
  const renderStatusCards = (cards: Card[], status: CardStatus) => {
    const context = layout === 'status' ? streamContext : () => <span>{STATUS_LABELS[status]}</span>;
    if (status === 'complete' || status === 'canceled') return <ArchiveCards cards={cards} status={status} renderCard={renderCard} renderContext={context} />;
    return cards.map(renderCard);
  };
  const sections = layout === 'status' ? columns.map(status => ({
    id: status, title: STATUS_LABELS[status], status,
    cards: allCards.filter(card => card.status === status).sort((a, b) =>
      status === 'complete' || status === 'canceled'
        ? new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime() : 0),
  })) : streams.map(stream => ({ id: stream.id, title: stream.title, stream, cards: cardsForStream(stream.id) }));
  return <div className={styles.sections} data-mobile-layout={layout}>
    {sections.map(section => {
      const stream = 'stream' in section ? section.stream : undefined;
      const status = 'status' in section ? section.status : undefined;
      const collapseHistory = layout === 'stream' && view === 'all';
      const historyCards = section.cards.filter(card => card.status === 'complete' || card.status === 'canceled');
      const renderColumns = (statuses: CardStatus[]) => statuses.map(status => {
        const cards = section.cards.filter(card => card.status === status);
        return cards.length > 0 ? <div key={status} className="space-y-2">{renderStatusCards(cards, status)}</div> : null;
      });
      const canAdd = stream ? stream.state === 'in_progress' : streams.some(stream => stream.state === 'in_progress');
      return <details key={section.id} open className={styles.section}>
        <summary className={`${styles.heading} focus-ring`}>
          <ChevronDown size={17} className={styles.chevron} aria-hidden="true" />
          {status ? <StatusHeader status={status} /> : <span className="flex min-w-0 items-center gap-2"><AreaIndicator area={stream!.area} /><span className="break-words">{section.title}</span></span>}
          <span className={styles.count} aria-label={`${section.cards.length} cards`}>{section.cards.length}</span>
        </summary>
        <div className={styles.sectionBody}>
          {stream && stream.title !== 'Uncategorized' && <button type="button" className="btn btn-ghost min-h-11 px-2 text-xs" onClick={() => onEditStream(stream)}>Stream details</button>}
          {status ? renderStatusCards(section.cards, status) : <>
            {renderColumns(collapseHistory ? columns.filter(status => status !== 'complete' && status !== 'canceled') : columns)}
            {collapseHistory && historyCards.length > 0 && <details className={styles.history} data-stream-history={section.id}>
              <summary className="focus-ring">
                <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
                <span>Complete / Canceled</span>
                <span className={styles.count} aria-label={`${historyCards.length} cards`}>{historyCards.length}</span>
              </summary>
              <div className="space-y-2 p-2 pt-0">{renderColumns(['complete', 'canceled'])}</div>
            </details>}
          </>}
          {section.cards.length === 0 && <p className="py-2 text-sm text-ink-muted">No cards in this status.</p>}
          {canAdd && <button type="button" className={styles.add} aria-label={`Add card to ${section.title}`} onClick={event => { event.currentTarget.focus(); onAdd({ streamId: stream?.id, status: status || columns[0] }); }}><Plus size={17} /> Add card</button>}
        </div>
      </details>;
    })}
  </div>;
}
