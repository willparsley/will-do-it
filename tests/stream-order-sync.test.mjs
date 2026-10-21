import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const streams = ['Alpha', 'Beta', 'zebra', 'Uncategorized'].map((title, id) => ({ id: String(id), title }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Run the real hook with effect cleanup and a controllable database/Realtime feed.
function harness() {
  const slots = [], pending = [], notices = [], channels = [];
  const win = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible';
  let index = 0, userId = 'a', snapshot = { ordered_ids: ['2', '0', '1'], revision: 1 }, saveResponse, getResponse;
  const restore = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) {
      const i = index++;
      if (!slots[i] || deps.some((dep, j) => dep !== slots[i].deps[j])) pending.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() };
      });
    },
  };
  const client = {
    rpc(name) { return name === 'move_stream' ? saveResponse.promise : getResponse?.promise || Promise.resolve({ data: snapshot }); },
    channel() {
      const channel = { on(_event, _filter, callback) { this.refresh = callback; return this; }, subscribe(callback) { this.status = callback; return this; } };
      channels.push(channel); return channel;
    },
    async removeChannel(channel) { channel.removed = true; },
  };
  const { useStreamOrder: renderHook } = loadTypeScript('components/useStreamOrder.ts', {
    react, '@/lib/supabase/client': { createClient: () => client }, sonner: { toast: { error: message => notices.push(message) } },
  });
  return {
    channels, notices,
    render() { index = 0; return renderHook(userId, streams); },
    effects() { while (pending.length) pending.shift()(); },
    set user(value) { userId = value; },
    set snapshot(value) { snapshot = value; },
    set save(value) { saveResponse = value; },
    set get(value) { getResponse = value; },
    focus() { win.dispatchEvent(new Event('focus')); },
    close() {
      for (const slot of slots) slot?.cleanup?.();
      for (const [key, descriptor] of restore) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
}

test('Realtime and focus refresh order; optimistic failure restores order and reconciles concurrent saves', async () => {
  const ui = harness();
  try {
    assert.equal(ui.render().disabled, true);
    ui.effects(); await tick();
    assert.deepEqual(ui.render().streams.map(s => s.id), ['2', '0', '1', '3']);
    ui.snapshot = { ordered_ids: ['1', '2', '0'], revision: 2 };
    ui.channels[0].refresh(); await tick();
    assert.deepEqual(ui.render().streams.map(s => s.id), ['1', '2', '0', '3']);
    const save = deferred(); ui.save = save;
    const action = ui.render().move('0', '1', false);
    assert.equal(ui.render().disabled, true);
    assert.deepEqual(ui.render().streams.map(s => s.id), ['0', '1', '2', '3']);
    // A concurrent device update arrives while the save is pending.
    ui.snapshot = { ordered_ids: ['2', '1', '0'], revision: 3 };
    ui.channels[0].refresh();
    save.resolve({ error: { message: 'Save failed' } }); await action; await tick();
    assert.deepEqual(ui.notices, ['Save failed']);
    assert.deepEqual(ui.render().streams.map(s => s.id), ['2', '1', '0', '3']);
    ui.snapshot = { ordered_ids: null, revision: 4 };
    ui.focus(); await tick();
    assert.equal(ui.render().custom, false);
    assert.deepEqual(ui.render().streams.map(s => s.id), ['0', '1', '2', '3']);
  } finally { ui.close(); }
});

test('account switch ignores late loads/saves and cleans up the previous Realtime channel', async () => {
  const ui = harness();
  try {
    ui.render(); ui.effects(); await tick();
    const save = deferred(); ui.save = save;
    const action = ui.render().move('0', '2', false);
    const read = deferred(); ui.get = read;
    ui.user = 'b';
    assert.equal(ui.render().custom, false);
    assert.equal(ui.render().disabled, true);
    ui.effects();
    assert.equal(ui.channels[0].removed, true);
    save.resolve({ data: { ordered_ids: ['2', '0', '1'], revision: 10 } }); await action;
    assert.equal(ui.render().custom, false);
    read.resolve({ data: null }); await tick();
    assert.equal(ui.render().disabled, false);
    assert.equal(ui.render().custom, false);
  } finally { ui.close(); }
});
