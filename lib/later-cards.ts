import type { Card } from './types';
import { calendarDay } from './card-views';

/** Earliest due/reminder calendar day, using the source timezone for recurrence. */
export function attentionDay(card: Card): string | undefined {
  const days = [card.due_at, card.remind_at]
    .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
    .map(value => calendarDay(value, card.recurrence_timezone));
  return days.sort()[0];
}

export function isLaterCard(card: Card, days: number, now = new Date()): boolean {
  if (card.status !== 'backlog' && card.status !== 'priority_backlog') return false;
  const day = attentionDay(card);
  if (!day) return false;
  // Add calendar days rather than 24-hour periods so DST cannot shift the boundary.
  const cutoff = new Date(`${calendarDay(now, card.recurrence_timezone)}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + days);
  return day > cutoff.toISOString().slice(0, 10);
}

export function splitLaterCards(cards: Card[], days: number, now = new Date()) {
  const visible: Card[] = [];
  const later: Card[] = [];
  for (const card of cards) (isLaterCard(card, days, now) ? later : visible).push(card);
  later.sort((a, b) => attentionDay(a)!.localeCompare(attentionDay(b)!) || a.position - b.position);
  return { visible, later };
}
