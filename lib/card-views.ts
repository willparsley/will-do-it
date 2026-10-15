import { subMonths, subYears } from 'date-fns';
import { ACTIVE_STATUSES, BACKLOG_STATUSES, Card, CardStatus, RecurrenceSource, STATUS_FLOW } from './types';

export type View = 'activated' | 'backlog' | 'all' | 'archive';
export type ArchivePeriod = 'month' | 'year' | 'all';

export function isTerminal(card: Pick<Card, 'status'>): boolean {
  return card.status === 'complete' || card.status === 'canceled';
}

export function statusesForView(view: View): CardStatus[] {
  if (view === 'activated') return ACTIVE_STATUSES;
  if (view === 'backlog') return [...BACKLOG_STATUSES, 'research'];
  if (view === 'archive') return ['complete', 'canceled'];
  return [...STATUS_FLOW, 'canceled'];
}

export function hydrateRecurringCards(cards: Card[], sources: RecurrenceSource[]): Card[] {
  const byId = new Map(sources.map(source => [source.id, source]));
  return cards.map(card => {
    const source = card.recurrence_source_id ? byId.get(card.recurrence_source_id) : undefined;
    return { ...card, last_completed_at: source?.last_completed_at || undefined,
      recurrence_timezone: source?.recurrence_timezone || undefined,
      recurrence_stream_id: source?.stream_id || undefined,
      recurrence_title: source?.base_title };
  });
}

export function displayStreamId(card: Card): string {
  return isTerminal(card) ? card.recurrence_stream_id || card.stream_id : card.stream_id;
}

export function cardsForStream(cards: Card[], streamId: string, view: View, period: ArchivePeriod, now = new Date()): Card[] {
  const statuses = statusesForView(view);
  const cutoff = period === 'month' ? subMonths(now, 1) : subYears(now, 1);
  return cards.filter(card => {
    if (displayStreamId(card) !== streamId || !statuses.includes(card.status)) return false;
    if (view !== 'archive' || period === 'all') return true;
    return !!card.completed_at && new Date(card.completed_at).getTime() >= cutoff.getTime();
  }).sort((a, b) => view === 'archive'
    ? new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime()
    : a.position - b.position);
}

export interface ArchiveGroup {
  id: string;
  title?: string;
  recurring: boolean;
  cards: Card[];
}

export function archiveGroups(cards: Card[]): ArchiveGroup[] {
  const groups = new Map<string, ArchiveGroup>();
  for (const card of cards) {
    const recurring = !!card.recurrence_source_id;
    const id = recurring ? `recurrence:${card.recurrence_source_id}` : `card:${card.id}`;
    const group = groups.get(id) || { id, title: card.recurrence_title || card.title, recurring, cards: [] };
    group.cards.push(card);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** ISO calendar day in the recurrence's timezone, independent of device timezone. */
export function calendarDay(value: string | Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function dueBadge(card: Card, now = new Date()): { kind: 'overdue' | 'today' | 'future'; label: string } | undefined {
  if (isTerminal(card) || !card.due_at) return;
  const due = calendarDay(card.due_at, card.recurrence_timezone);
  const today = calendarDay(now, card.recurrence_timezone);
  if (due < today) return { kind: 'overdue', label: 'Overdue' };
  if (due === today) return { kind: 'today', label: 'Today' };
  return { kind: 'future', label: new Date(card.due_at).toLocaleDateString(undefined, { timeZone: card.recurrence_timezone }) };
}
