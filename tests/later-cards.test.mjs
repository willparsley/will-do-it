import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { loadTypeScript } from './helpers/load-typescript.mjs';
import { nodes, text } from './helpers/react-driver.mjs';

const { isLaterCard, splitLaterCards } = loadTypeScript('lib/later-cards.ts');
const prefs = loadTypeScript('lib/later-preferences.ts');
const now = new Date('2026-11-06T12:00:00Z');
const card = (id, due_at, extra = {}) => ({ id, title: id, due_at, status: 'backlog', position: 0, recurrence_timezone: 'UTC', ...extra });

test('Later uses an inclusive calendar-day lead window for both backlog statuses and both card kinds', () => {
  for (const status of ['backlog', 'priority_backlog']) for (const is_recurring of [true, false]) {
    assert.equal(isLaterCard(card('boundary', '2026-11-09T23:59:00Z', { status, is_recurring, recurrence_timezone: 'UTC' }), 3, now), false);
    assert.equal(isLaterCard(card('future', '2026-11-10T00:00:00Z', { status, is_recurring, recurrence_timezone: 'UTC' }), 3, now), true);
  }
  for (const status of ['research', 'waiting', 'in_progress', 'complete', 'canceled']) {
    assert.equal(isLaterCard(card('active', '2027-06-01', { status }), 3, now), false);
  }
  assert.equal(isLaterCard(card('undated'), 3, now), false);
  assert.equal(isLaterCard(card('invalid', 'bad'), 3, now), false);
  assert.equal(isLaterCard(card('overdue', '2026-11-01'), 3, now), false);
});

test('Earlier reminders prevent hiding and lead windows support zero and custom values', () => {
  const future = card('future', '2027-01-01T12:00:00Z', { remind_at: '2026-11-08T12:00:00Z' });
  assert.equal(isLaterCard(future, 3, now), false);
  assert.equal(isLaterCard(future, 0, now), true);
  assert.equal(isLaterCard(card('reminder only', undefined, { remind_at: '2027-01-01T12:00:00Z' }), 3, now), true);
  assert.equal(isLaterCard(card('tomorrow', '2026-11-07T12:00:00Z'), 0, now), true);
  assert.equal(isLaterCard(card('today', '2026-11-06T12:00:00Z'), 0, now), false);
  assert.equal(isLaterCard(card('future', '2027-01-01T12:00:00Z'), 365, now), false);
});

test('Source timezone and DST boundaries use calendar arithmetic', () => {
  const nearMidnight = new Date('2026-11-07T02:00:00Z'); // Nov 6 in New York, Nov 7 in Tokyo
  assert.equal(isLaterCard(card('NY', '2026-11-10T04:30:00Z', { recurrence_timezone: 'America/New_York' }), 3, nearMidnight), false);
  assert.equal(isLaterCard(card('NY future', '2026-11-10T05:00:00Z', { recurrence_timezone: 'America/New_York' }), 3, nearMidnight), true);
  assert.equal(isLaterCard(card('Tokyo', '2026-11-10T15:00:00Z', { recurrence_timezone: 'Asia/Tokyo' }), 3, nearMidnight), true);
  const spring = new Date('2026-03-07T17:00:00Z');
  assert.equal(isLaterCard(card('DST boundary', '2026-03-10T23:30:00-04:00', { recurrence_timezone: 'America/New_York' }), 3, spring), false);
});

test('Splitting retains visible position order and sorts Later by earliest attention date', () => {
  const cards = [card('far', '2027-01-01'), card('undated'), card('soon', '2026-11-08'), card('nearer', '2026-12-01')];
  const result = splitLaterCards(cards, 3, now);
  assert.deepEqual(result.visible.map(c => c.id), ['undated', 'soon']);
  assert.deepEqual(result.later.map(c => c.id), ['nearer', 'far']);
  assert.equal(cards[0].id, 'far');
});

test('Later disclosure starts collapsed, has count/date/status context, and renders full cards', () => {
  const { LaterCards } = loadTypeScript('components/LaterCards.tsx');
  const tree = LaterCards({ cards: [card('ordinary', '2027-01-01'), card('recurring', '2026-12-01', { is_recurring: true }), card('visible')], days: 3, now, status: 'backlog', showStatus: true, renderCard: c => React.createElement('article', { key: c.id }, c.title) });
  const details = nodes(tree, n => n.type === 'details')[0];
  assert.equal(details.props.open, undefined);
  assert.match(text(nodes(details, n => n.type === 'summary')), /Later · Backlog · 2Next Dec 1, 2026/);
  assert.deepEqual(nodes(details, n => n.type === 'article').map(text), ['recurring', 'ordinary']);
  assert.equal(nodes(LaterCards({ cards: [card('visible')], days: 3, now, status: 'backlog', renderCard: c => c.title }), n => n.type === 'details').length, 0);
});

test('Later preferences default safely, isolate accounts, and survive unavailable storage', () => {
  for (const bad of [null, '', '3', -1, 1.5, 3651, {}, Infinity]) assert.equal(prefs.parseLaterDays(bad), 3);
  assert.equal(prefs.parseLaterDays(0), 0);
  assert.equal(prefs.parseLaterDays(30), 30);
  const oldStorage = globalThis.localStorage, oldWindow = globalThis.window;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  globalThis.window = { dispatchEvent() {} };
  try {
    assert.equal(prefs.saveLaterDays('one', 7), true);
    assert.equal(prefs.readLaterDays('one'), 7);
    assert.equal(prefs.readLaterDays('two'), 3);
    prefs.saveLaterDays('two', 0);
    assert.equal(prefs.readLaterDays('two'), 0);
    values.set('will-do-it:later-days:one', '{bad');
    assert.equal(prefs.readLaterDays('one'), 3);
    globalThis.localStorage = { getItem() { throw Error(); }, setItem() { throw Error(); } };
    assert.equal(prefs.readLaterDays('one'), 3);
    assert.equal(prefs.saveLaterDays('one', 1), false);
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});
