import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypeScript } from './helpers/load-typescript.mjs';
const { prepareOfflineAccount, saveOfflineWorkspace, clearOfflineWorkspace, OFFLINE_ACCOUNT_KEY, OFFLINE_WORKSPACE_KEY } = loadTypeScript('lib/offline-workspace.ts');
const { watchAccount } = loadTypeScript('lib/supabase/account-boundary.ts');

function storageTest(run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { run(storage); } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
}
const streams = [{ id: 's', user_id: 'a', title: 'Flight tasks', area: 'personal' }];
const cards = [{ id: 'c', user_id: 'a', stream_id: 's', title: 'Read notes', notes: 'Offline notes', status: 'research' }];

test('offline snapshot is atomic, contains notes, and replaces deleted cards', () => storageTest(storage => {
  prepareOfflineAccount('a');
  assert.equal(saveOfflineWorkspace('a', streams, cards), true);
  const first = JSON.parse(storage.getItem(OFFLINE_WORKSPACE_KEY));
  assert.equal(first.cards[0].notes, 'Offline notes');
  assert.ok(Number.isFinite(Date.parse(first.savedAt)));
  assert.equal(saveOfflineWorkspace('a', streams, []), true);
  assert.deepEqual(JSON.parse(storage.getItem(OFFLINE_WORKSPACE_KEY)).cards, []);
}));

test('account switches and sign-out erase the copy and reject late or foreign data', () => storageTest(storage => {
  prepareOfflineAccount('a'); saveOfflineWorkspace('a', streams, cards);
  prepareOfflineAccount('b');
  assert.equal(storage.getItem(OFFLINE_WORKSPACE_KEY), null);
  assert.equal(saveOfflineWorkspace('a', streams, cards), false);
  assert.equal(saveOfflineWorkspace('b', streams, cards), false);
  clearOfflineWorkspace();
  assert.equal(storage.getItem(OFFLINE_ACCOUNT_KEY), null);
  assert.equal(saveOfflineWorkspace('b', [], []), false);
}));

test('auth boundary clears saved cards even when sign-out happens before initial identity', () => storageTest(storage => {
  prepareOfflineAccount('a'); saveOfflineWorkspace('a', streams, cards);
  let emit;
  const boundary = watchAccount({ auth: { onAuthStateChange(callback) { emit = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }, () => {});
  // Missing initial session can occur during a failed network refresh.
  emit('INITIAL_SESSION', null);
  assert.notEqual(storage.getItem(OFFLINE_WORKSPACE_KEY), null);
  emit('SIGNED_OUT', null);
  assert.equal(storage.getItem(OFFLINE_WORKSPACE_KEY), null);
  assert.equal(boundary.acceptUser('a'), false);
  boundary.dispose();
}));

test('quota errors remove stale snapshots without breaking the online workspace', () => storageTest(storage => {
  prepareOfflineAccount('a'); saveOfflineWorkspace('a', streams, cards);
  storage.setItem = () => { throw new Error('quota exceeded'); };
  assert.equal(saveOfflineWorkspace('a', streams, []), false);
  assert.equal(storage.getItem(OFFLINE_WORKSPACE_KEY), null);
}));

test('unavailable storage is handled safely', () => storageTest(storage => {
  storage.getItem = () => { throw new Error('storage disabled'); };
  assert.doesNotThrow(() => prepareOfflineAccount('a'));
  assert.equal(saveOfflineWorkspace('a', [], []), false);
  assert.doesNotThrow(clearOfflineWorkspace);
}));

test('temporary auth-network failures open the saved view without erasing cards', async () => {
  const { driver } = await import('./helpers/react-driver.mjs');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map(); const redirects = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { replace: url => redirects.push(url) } } });
  let cleanup;
  try {
    prepareOfflineAccount('a'); saveOfflineWorkspace('a', streams, cards);
    const ui = driver('app/page.tsx', 'default', {}, {
      'next/link': () => null, 'next/image': () => null,
      sonner: { toast: { dismiss() {}, error() {}, success() {} } },
      '@/lib/supabase/client': { createClient: () => ({ auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getUser: async () => ({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0 } }),
      } }) },
      '@dnd-kit/core': { useSensors: () => [], useSensor: () => null, MouseSensor() {}, TouchSensor() {}, DndContext() {}, DragOverlay() {}, pointerWithin() {} },
    });
    ui.render(); cleanup = ui.effects[0]();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(redirects, ['/offline.html']);
    assert.equal(JSON.parse(values.get(OFFLINE_WORKSPACE_KEY)).cards[0].title, 'Read notes');
  } finally {
    cleanup?.();
    for (const [key, original] of [['localStorage', originalStorage], ['window', originalWindow]]) {
      if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key];
    }
  }
});
