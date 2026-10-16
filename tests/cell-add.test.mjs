import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes } from './helpers/react-driver.mjs';

// Exercise refreshed props against an open form: the baseline must stay fixed,
// even if the initially selected stream is reordered or no longer selectable.
const stream = (id, title = id) => ({ id, title, state: 'in_progress', area: 'neutral', position: 0 });
function form(props) {
  return driver('components/AddCardModal.tsx', 'AddCardModal', props, {
    '@/lib/supabase/client': { createClient: () => ({}) },
  });
}
const select = (tree, label) => nodes(tree, node => node.props?.['aria-label'] === label && node.props?.onValueChange)[0];

test('creation defaults are clean, editable, and stable while board props refresh', () => {
  const props = { streams: [stream('one'), stream('unc', 'Uncategorized')], defaultStreamId: 'one', defaultStatus: 'review', onClose() {}, onCardCreated() {} };
  const ui = form(props);
  let tree = ui.render();
  assert.equal(tree.props.dirty, false);
  assert.equal(select(tree, 'Stream').props.value, 'one');
  assert.equal(select(tree, 'Status').props.value, 'review');
  select(tree, 'Status').props.onValueChange('waiting');
  tree = ui.render();
  assert.equal(tree.props.dirty, true);
  props.streams = [stream('other'), stream('unc', 'Uncategorized')];
  props.defaultStreamId = 'other';
  props.defaultStatus = 'backlog';
  tree = ui.render();
  assert.equal(select(tree, 'Stream').props.value, 'one');
  assert.equal(select(tree, 'Status').props.value, 'waiting');
  select(tree, 'Status').props.onValueChange('review');
  assert.equal(ui.render().props.dirty, false, 'Dirty comparison retains the original defaults');
  const nextOpening = form(props).render();
  assert.equal(select(nextOpening, 'Stream').props.value, 'other');
  assert.equal(select(nextOpening, 'Status').props.value, 'backlog');
  assert.equal(nextOpening.props.dirty, false);
});

test('Quick Add keeps Uncategorized and Backlog as its clean defaults', () => {
  const props = { streams: [stream('one'), stream('unc', 'Uncategorized')], onClose() {}, onCardCreated() {} };
  const ui = form(props);
  assert.equal(select(ui.render(), 'Stream').props.value, 'unc');
  assert.equal(select(ui.render(), 'Status').props.value, 'backlog');
  props.streams = [stream('one')];
  assert.equal(ui.render().props.dirty, false);
  assert.equal(select(ui.render(), 'Stream').props.value, 'unc');
});
