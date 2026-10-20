'use client';

import { ReactNode, useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/lib/types';
import { DEFAULT_HISTORY_LIMIT, type HistoryLimit } from '@/lib/history-preferences';
import { archiveGroups } from '@/lib/card-views';

export function LimitedHistory({ items, limit }: { items: ReactNode[]; limit: HistoryLimit }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const truncated = limit !== 'all' && items.length > limit;
  return <>
    <div id={id} className="space-y-2">{truncated && !expanded ? items.slice(0, limit) : items}</div>
    {truncated && <button type="button" className="btn btn-ghost focus-ring min-h-11 w-full px-2 text-sm" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Show less' : `Show all ${items.length} (${items.length - limit} more)`}
    </button>}
  </>;
}

export function ArchiveCards({ limit = DEFAULT_HISTORY_LIMIT, cards, status, renderCard, renderContext }: {
  limit?: HistoryLimit;
  cards: Card[];
  status: 'complete' | 'canceled';
  renderCard: (card: Card) => ReactNode;
  renderContext?: (card: Card) => ReactNode;
}) {
  return <LimitedHistory limit={limit} items={archiveGroups(cards).map(group => group.recurring ? (
    <details key={group.id} className="group/history rounded-lg border border-line bg-surface">
      <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg p-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open/history:rotate-90" />
        <span className="min-w-0">
          <span className="block break-words">{group.title}</span>
          {renderContext && <span className="block text-xs font-normal text-ink-soft">{renderContext(group.cards[0])}</span>}
          <span className="block text-xs font-normal text-ink-soft">
            {group.cards.length} {status === 'complete' ? 'completed' : 'canceled'}
          </span>
        </span>
      </summary>
      <div className="space-y-2 p-2 pt-0"><LimitedHistory limit={limit} items={group.cards.map(renderCard)} /></div>
    </details>
  ) : <div key={group.id}>{group.cards.map(renderCard)}</div>)} />;
}
