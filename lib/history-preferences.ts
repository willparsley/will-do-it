export type HistoryLimit = number | 'all';
export const DEFAULT_HISTORY_LIMIT: HistoryLimit = 5;
export const HISTORY_LIMIT_EVENT = 'will-do-it:history-limit';

export function parseHistoryLimit(value: unknown): HistoryLimit {
  return value === 'all' || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    ? value : DEFAULT_HISTORY_LIMIT;
}

export function readHistoryLimit(userId: string): HistoryLimit {
  try { return parseHistoryLimit(JSON.parse(localStorage.getItem(`will-do-it:history-limit:${userId}`) || 'null')); }
  catch { return DEFAULT_HISTORY_LIMIT; }
}

export function saveHistoryLimit(userId: string, limit: HistoryLimit): boolean {
  try {
    localStorage.setItem(`will-do-it:history-limit:${userId}`, JSON.stringify(limit));
    window.dispatchEvent(new Event(HISTORY_LIMIT_EVENT));
    return true;
  } catch { return false; }
}
