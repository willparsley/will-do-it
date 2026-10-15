'use client';

import { ReactNode } from 'react';
import { Card } from '@/lib/types';
import { archiveGroups } from '@/lib/card-views';

export function ArchiveCards({ cards, renderCard }: { cards: Card[]; renderCard: (card: Card) => ReactNode }) {
  return archiveGroups(cards).map(group => group.recurring ? (
    <details key={group.id} className="rounded-lg border border-line bg-surface p-2">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        {group.title}
        <span className="ml-2 text-xs font-normal text-ink-muted">
          {group.cards.length} {group.cards.length === 1 ? 'occurrence' : 'occurrences'}
        </span>
      </summary>
      <div className="mt-2 space-y-2">{group.cards.map(renderCard)}</div>
    </details>
  ) : <div key={group.id}>{group.cards.map(renderCard)}</div>);
}
