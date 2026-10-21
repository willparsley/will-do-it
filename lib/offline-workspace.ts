import type { Card, Stream } from './types';

// A single local copy, never tokens or a cache of authenticated HTTP responses.
export const OFFLINE_ACCOUNT_KEY = 'will-do-it:offline-account:v1';
export const OFFLINE_WORKSPACE_KEY = 'will-do-it:offline-workspace:v1';

export function clearOfflineWorkspace() {
  try {
    localStorage.removeItem(OFFLINE_ACCOUNT_KEY);
    localStorage.removeItem(OFFLINE_WORKSPACE_KEY);
  } catch { /* Private browsing/storage restrictions must not break sign-out. */ }
}

export function prepareOfflineAccount(userId: string) {
  try {
    if (localStorage.getItem(OFFLINE_ACCOUNT_KEY) !== userId) {
      // Remove the previous account before marking the next account active.
      clearOfflineWorkspace();
      localStorage.setItem(OFFLINE_ACCOUNT_KEY, userId);
    }
  } catch { /* Saving will report unavailable storage to the workspace. */ }
}

export function saveOfflineWorkspace(userId: string, streams: Stream[], cards: Card[]): boolean {
  try {
    // Reject late responses from an account that has signed out or switched.
    if (localStorage.getItem(OFFLINE_ACCOUNT_KEY) !== userId) return false;
    if (streams.some(stream => stream.user_id !== userId) || cards.some(card => card.user_id !== userId)) return false;
    localStorage.setItem(OFFLINE_WORKSPACE_KEY, JSON.stringify({
      version: 1, userId, savedAt: new Date().toISOString(), streams, cards,
    }));
    return true;
  } catch {
    // Never leave an older copy looking current after a quota/storage failure.
    try { localStorage.removeItem(OFFLINE_WORKSPACE_KEY); } catch { /* Storage unavailable. */ }
    return false;
  }
}
