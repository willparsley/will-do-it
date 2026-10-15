import test from 'node:test';
import assert from 'node:assert/strict';
import { driver, nodes } from './helpers/react-driver.mjs';

function dropdown(props = {}) {
  const changes = [];
  const inputs = {
    value: '', 'aria-label': 'Action',
    options: [{ value: 'move', label: 'Move' }, { value: 'stop', label: 'Stop' }],
    onValueChange: value => changes.push(value), ...props,
  };
  const ui = driver('components/AppSelect.tsx', 'AppSelect', inputs);
  return { ...ui, changes, inputs };
}

test('dropdown forwards selection values and ignores empty or disabled updates', () => {
  const ui = dropdown();
  ui.render().props.onSelectionChange('move');
  ui.render().props.onSelectionChange(null);
  ui.inputs.disabled = true;
  ui.render().props.onSelectionChange('stop');
  assert.deepEqual(ui.changes, ['move']);
});

for (const key of ['Escape', 'Tab']) test(`${key} closes the menu and restores the trigger without swallowing Tab navigation`, () => {
  const ui = dropdown();
  ui.render().props.onOpenChange(true);
  const tree = ui.render();
  assert.equal(tree.props.isOpen, true);
  let focused = false, stopped = false;
  nodes(tree, node => node.props?.className === 'trigger')[0].props.ref.current = {
    focus() { focused = true; },
  };
  nodes(tree, node => node.type === 'div' && node.props.onKeyDown)[0].props.onKeyDown({
    key, stopPropagation() { stopped = true; },
  });
  assert.equal(ui.render().props.isOpen, false);
  assert.equal(focused, true);
  assert.equal(stopped, key === 'Escape');
});

test('disabling an open dropdown closes it and does not reopen after a failed save', () => {
  const ui = dropdown();
  ui.render().props.onOpenChange(true);
  assert.equal(ui.render().props.isOpen, true);
  ui.inputs.disabled = true;
  assert.equal(ui.render().props.isOpen, false);
  ui.inputs.disabled = false;
  assert.equal(ui.render().props.isOpen, false);
});

test('closed dropdown renders only the selected label or placeholder, without menu decorations', () => {
  const ui = dropdown({ placeholder: 'Choose an action' });
  const value = nodes(ui.render(), node => node.props?.className === 'value')[0];
  assert.equal(value.props.children({ selectedText: 'Move', isPlaceholder: false }), 'Move');
  assert.equal(value.props.children({ selectedText: '', isPlaceholder: true }), 'Choose an action');
});
