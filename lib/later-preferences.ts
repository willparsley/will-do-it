export const DEFAULT_LATER_DAYS = 3;
export const LATER_DAYS_EVENT = 'will-do-it:later-days';

export function parseLaterDays(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 3650
    ? value : DEFAULT_LATER_DAYS;
}

export function readLaterDays(userId: string): number {
  try { return parseLaterDays(JSON.parse(localStorage.getItem(`will-do-it:later-days:${userId}`) || 'null')); }
  catch { return DEFAULT_LATER_DAYS; }
}

export function saveLaterDays(userId: string, days: number): boolean {
  try {
    localStorage.setItem(`will-do-it:later-days:${userId}`, JSON.stringify(parseLaterDays(days)));
    window.dispatchEvent(new Event(LATER_DAYS_EVENT));
    return true;
  } catch { return false; }
}
