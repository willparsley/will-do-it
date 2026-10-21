import { type Stream, streamsForDisplay } from './types';

export interface StreamOrder { ordered_ids: string[] | null; revision: number }
export const alphabeticalOrder: StreamOrder = { ordered_ids: null, revision: 0 };

/** Missing/new streams append alphabetically; deleted IDs are harmless. */
export function orderedStreams(streams: Stream[], ids: string[] | null): Stream[] {
  const alphabetical = streamsForDisplay(streams);
  if (!ids) return alphabetical;
  const ranks = new Map(ids.map((id, index) => [id, index]));
  return alphabetical.sort((a, b) => {
    if (a.title === 'Uncategorized' || b.title === 'Uncategorized') {
      return Number(a.title === 'Uncategorized') - Number(b.title === 'Uncategorized');
    }
    return (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || 0;
  });
}

export function moveStreamOrder(streams: Stream[], ids: string[] | null, moved: string, target: string, after: boolean): string[] {
  const result = orderedStreams(streams, ids).filter(s => s.title !== 'Uncategorized' && s.id !== moved).map(s => s.id);
  const index = result.indexOf(target);
  if (index < 0) return ids || result;
  result.splice(index + Number(after), 0, moved);
  return result;
}
