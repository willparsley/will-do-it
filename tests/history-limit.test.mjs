import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadTypeScript } from './helpers/load-typescript.mjs';
import { nodes, text } from './helpers/react-driver.mjs';

const preferences = loadTypeScript('lib/history-preferences.ts');

test('history preferences validate numbers and All, isolate accounts, and handle unavailable storage', () => {
  for (const invalid of [null, 0, -1, 1.5, '5', {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(preferences.parseHistoryLimit(invalid), 5);
  }
  assert.equal(preferences.parseHistoryLimit(3), 3);
  assert.equal(preferences.parseHistoryLimit('all'), 'all');
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  globalThis.window = { dispatchEvent() {} };
  try {
    assert.equal(preferences.saveHistoryLimit('one', 12), true);
    assert.equal(preferences.readHistoryLimit('one'), 12);
    assert.equal(preferences.readHistoryLimit('two'), 5);
    assert.equal(preferences.saveHistoryLimit('two', 'all'), true);
    assert.equal(preferences.readHistoryLimit('two'), 'all');
    assert.equal(preferences.readHistoryLimit('one'), 12);
    values.set('will-do-it:history-limit:one', '{bad');
    assert.equal(preferences.readHistoryLimit('one'), 5);
    globalThis.localStorage = { getItem() { throw Error(); }, setItem() { throw Error(); } };
    assert.equal(preferences.readHistoryLimit('one'), 5);
    assert.equal(preferences.saveHistoryLimit('one', 3), false);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('history lists expand and collapse independently, keep newest order, and support All', () => {
  let expanded = false;
  const { LimitedHistory } = loadTypeScript('components/ArchiveCards.tsx', {
    react: { ...React, useId: () => 'history-list', useState: () => [expanded, update => { expanded = update(expanded); }] },
  });
  const items = Array.from({ length: 8 }, (_, i) => React.createElement('article', { key: i }, `Card ${i}`));
  const render = limit => LimitedHistory({ items, limit });
  let tree = render(5);
  assert.equal(nodes(tree, node => node.type === 'article').length, 5);
  assert.equal(text(nodes(tree, node => node.type === 'article')[0]), 'Card 0');
  let toggle = nodes(tree, node => node.type === 'button')[0];
  assert.equal(text(toggle), 'Show all 8 (3 more)');
  assert.equal(toggle.props['aria-controls'], 'history-list');
  toggle.props.onClick();
  tree = render(5);
  assert.equal(nodes(tree, node => node.type === 'article').length, 8);
  toggle = nodes(tree, node => node.type === 'button')[0];
  assert.equal(toggle.props['aria-expanded'], true);
  toggle.props.onClick();
  assert.equal(nodes(render(5), node => node.type === 'article').length, 5);
  assert.equal(nodes(render('all'), node => node.type === 'article').length, 8);
  assert.equal(nodes(render('all'), node => node.type === 'button').length, 0);
  assert.equal(nodes(render(10), node => node.type === 'button').length, 0);
});

test('recurring groups retain full counts while both list levels receive the chosen limit', () => {
  const { ArchiveCards } = loadTypeScript('components/ArchiveCards.tsx');
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: String(i), title: 'Recurring task', recurrence_source_id: 'source', completed_at: new Date(2026, 9, 20 - i).toISOString() }));
  const tree = ArchiveCards({ cards, status: 'complete', limit: 3, renderCard: card => React.createElement('article', { key: card.id }, card.id) });
  assert.equal(tree.props.limit, 3);
  assert.equal(tree.props.items.length, 1);
  assert.match(text(tree.props.items), /8 completed/);
  const inner = nodes(tree.props.items, node => node.props?.items)[0];
  assert.equal(inner.props.limit, 3);
  assert.equal(inner.props.items.length, 8);
});
