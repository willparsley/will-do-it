import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes, button } from './helpers/react-driver.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function workspace() {
  let refresh, gate;
  let storedCards = [{ id: 'card', stream_id: 'work', title: 'Task', status: 'waiting', position: 0, is_recurring: true, recurrence_source_id: 'source' }];
  let storedStreams = [{ id: 'work', title: 'Work', state: 'in_progress', area: 'neutral' }, { id: 'unc', title: 'Uncategorized', state: 'in_progress', area: 'neutral' }];
  let sources = [{ id: 'source', stream_id: 'work', base_title: 'Repeat' }];
  const calls = [];
  const supabase = {
    auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, async getUser() { return { data: { user: { id: 'user' } } }; } },
    async rpc(name) {
      calls.push(name);
      if (name === 'save_card_with_undo') {
        storedCards = storedCards.map(card => ({ ...card, status: 'complete', completed_at: new Date().toISOString() }));
        return { data: { card: storedCards[0], undo_id: 'undo' } };
      }
      return { data: 0 };
    },
    from(table) { return {
      select() { return this; },
      eq() { return table === 'streams' ? this : Promise.resolve({ data: table === 'cards' ? storedCards : sources }); },
      async order() { calls.push('streams'); if (gate) { const current = gate; gate = null; return current; } return { data: storedStreams }; },
    }; },
  };
  const ui = driver('app/page.tsx', 'default', {}, {
    '@/lib/supabase/client': { createClient: () => supabase },
    '@/components/useStreamOrder': { useStreamOrder: (_user, streams) => ({ streams, disabled: false, move() {} }) },
    '@/lib/workspace-refresh': { watchWorkspaceRefresh: callback => { refresh = callback; return () => {}; } },
    sonner: { toast: { error() {}, success() {} } },
    '@dnd-kit/core': { DragOverlay() {}, KeyboardSensor: class { static activators = []; } },
  });
  ui.render(); ui.effects[0](); await tick();
  const start = ui.effects.length; ui.render(); ui.effects[start + 1]();
  const card = () => nodes(ui.render(), node => node.props.card?.id === 'card')[0];
  return {
    ui, calls, card,
    refresh: () => refresh(),
    set cards(value) { storedCards = value; },
    set streams(value) { storedStreams = value; },
    set sources(value) { sources = value; },
    set gate(value) { gate = value; },
  };
}

test('background refresh reconciles streams, cards, and recurring source metadata without running task writes', async () => {
  const ws = await workspace();
  ws.streams = [{ id: 'other', title: 'Renamed remotely', state: 'in_progress', area: 'neutral' }];
  ws.sources = [{ id: 'source', stream_id: 'other', base_title: 'Updated repeat' }];
  ws.cards = [{ id: 'card', stream_id: 'other', title: 'Task', status: 'waiting', position: 0, is_recurring: true, recurrence_source_id: 'source' }];
  await ws.refresh();
  assert.equal(ws.card().props.card.recurrence_stream_id, 'other');
  assert.equal(ws.card().props.card.recurrence_title, 'Updated repeat');
  assert.deepEqual(ws.calls.filter(name => name !== 'streams'), ['generate_recurring_instances', 'promote_due_cards']);
  ws.cards = [];
  await ws.refresh();
  assert.equal(ws.card(), undefined);
});

test('a delayed background read cannot overwrite optimistic completion; drags defer background loads', async () => {
  const ws = await workspace();
  let release;
  ws.gate = new Promise(resolve => { release = resolve; });
  const delayed = ws.refresh();
  button(ws.ui.render(), 'All').props.onClick();
  await ws.card().props.onComplete('card');
  assert.equal(ws.card().props.card.status, 'complete');
  release({ data: [] }); await delayed;
  assert.equal(ws.card().props.card.status, 'complete');
  const drag = nodes(ws.ui.render(), node => typeof node.props.onDragStart === 'function')[0];
  drag.props.onDragStart({ active: { id: 'card' } });
  const reads = ws.calls.length;
  await ws.refresh();
  assert.equal(ws.calls.length, reads);
  drag.props.onDragCancel();
  await ws.refresh();
  assert.equal(ws.calls.length, reads + 1);
});
