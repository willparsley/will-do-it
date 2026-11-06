'use client';

import type { ReactNode } from 'react';
import { ChevronRight, CalendarDays } from 'lucide-react';
import type { Card, CardStatus } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/types';
import { attentionDay, splitLaterCards } from '@/lib/later-cards';

export function LaterCards({ cards, days, now, status, showStatus = false, renderCard }: {
  cards: Card[]; days: number; now?: Date; status: CardStatus; showStatus?: boolean;
  renderCard: (card: Card) => ReactNode;
}) {
  const { visible, later } = splitLaterCards(cards, days, now);
  const next = later.length ? new Date(`${attentionDay(later[0])}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  return <>
    {visible.map(renderCard)}
    {later.length > 0 && <details className="group/later rounded-lg border border-line bg-surface/60" data-later-status={status}>
      <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg p-2 text-sm text-ink-soft [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open/later:rotate-90" />
        <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">Later{showStatus ? ` · ${STATUS_LABELS[status]}` : ''} · {later.length}</span>
          <span className="block text-xs">Next {next}</span>
        </span>
      </summary>
      <div className="space-y-2 border-t border-line p-2">{later.map(renderCard)}</div>
    </details>}
  </>;
}
