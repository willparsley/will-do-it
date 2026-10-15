import { Card } from './types';

export function isCardBlocked(card: Card, prerequisite?: Card): boolean {
  return card.status !== 'complete' && card.status !== 'canceled'
    && !!card.prerequisite_card_id && prerequisite?.status !== 'complete';
}

/** Exclude the edited card and any card that already depends on it. */
export function prerequisiteCandidates(cards: Card[], cardId?: string): Card[] {
  const excluded = new Set(cardId ? [cardId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const card of cards) {
      if (card.prerequisite_card_id && excluded.has(card.prerequisite_card_id) && !excluded.has(card.id)) {
        excluded.add(card.id);
        changed = true;
      }
    }
  }
  return cards.filter(card => !excluded.has(card.id))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
