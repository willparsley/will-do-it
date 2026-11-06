import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { watchWorkspaceRefresh } = loadTypeScript('lib/workspace-refresh.ts');
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function setup(t, refresh) {
  const win = new EventTarget(), doc = new EventTarget(), nav = { onLine: true };
  doc.visibilityState = 'visible';
  const saved = ['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of [['window', win], ['document', doc], ['navigator', nav]]) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const stop = watchWorkspaceRefresh(refresh);
  t.after(() => {
    stop(); t.mock.timers.reset();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { win, doc, nav, stop, async tick(ms) { t.mock.timers.tick(ms); await flush(); } };
}

test('tab wake events coalesce, visible tabs refresh each minute, hidden/offline tabs stay quiet', async t => {
  let reads = 0;
  const ui = setup(t, async () => { ++reads; });
  ui.win.dispatchEvent(new Event('focus'));
  ui.doc.dispatchEvent(new Event('visibilitychange'));
  await ui.tick(250);
  assert.equal(reads, 1);
  await ui.tick(60_000); await ui.tick(250);
  assert.equal(reads, 2);
  ui.doc.visibilityState = 'hidden';
  ui.win.dispatchEvent(new Event('focus'));
  await ui.tick(120_000); await ui.tick(250);
  assert.equal(reads, 2);
  ui.doc.visibilityState = 'visible'; ui.nav.onLine = false;
  ui.doc.dispatchEvent(new Event('visibilitychange'));
  await ui.tick(60_000); await ui.tick(250);
  assert.equal(reads, 2);
  ui.nav.onLine = true; ui.win.dispatchEvent(new Event('online'));
  await ui.tick(250);
  assert.equal(reads, 3);
  ui.win.dispatchEvent(new Event('pageshow'));
  await ui.tick(250);
  assert.equal(reads, 4);
  ui.stop(); ui.win.dispatchEvent(new Event('focus'));
  await ui.tick(120_000);
  assert.equal(reads, 4);
});

test('slow refreshes never overlap; missed wake is reconciled once; failures retry on next wake', async t => {
  let reads = 0, release;
  const ui = setup(t, async () => {
    ++reads;
    if (reads === 1) await new Promise(resolve => { release = resolve; });
    if (reads === 2) throw new Error('offline');
  });
  ui.win.dispatchEvent(new Event('focus')); await ui.tick(250);
  ui.win.dispatchEvent(new Event('focus')); await ui.tick(250);
  ui.win.dispatchEvent(new Event('online')); await ui.tick(250);
  assert.equal(reads, 1);
  release(); await flush(); await ui.tick(250);
  assert.equal(reads, 2);
  ui.win.dispatchEvent(new Event('focus')); await ui.tick(250);
  assert.equal(reads, 3);
});

test('cleanup prevents a pending timer or an in-flight refresh from scheduling more work', async t => {
  let reads = 0, release;
  const ui = setup(t, async () => { ++reads; await new Promise(resolve => { release = resolve; }); });
  ui.win.dispatchEvent(new Event('focus')); await ui.tick(250);
  ui.win.dispatchEvent(new Event('focus')); await ui.tick(250);
  ui.stop(); release(); await flush(); await ui.tick(120_000);
  assert.equal(reads, 1);
});
