import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { hydrateRecurringCards, displayStreamId, cardsForStream, archiveGroups, dueBadge, statusesForView } = loadTypeScript('lib/card-views.ts');
const { dateTimeLocal, dateTimeInstant, withCalendarDay } = loadTypeScript('lib/dates.ts');
const { CardView } = loadTypeScript('components/Card.tsx');
const { ArchiveCards } = loadTypeScript('components/ArchiveCards.tsx');
const source = { id:'source',stream_id:'new-stream',base_title:'Take a walk',last_completed_at:'2026-10-14T12:00:00Z',recurrence_timezone:'America/New_York' };
const base = { id:'card',title:'Take a walk - 2026-10-15',stream_id:'old-stream',user_id:'user',position:0,status:'waiting',is_recurring:true,recurrence_source_id:'source',due_at:'2026-10-15T04:00:00Z' };
const now = new Date('2026-10-15T16:00:00Z');

test('hydration supplies last completion, timezone, and current stream without rewriting stored stream', () => {
  const [active, archived] = hydrateRecurringCards([base,{...base,id:'old',status:'complete'}],[source]);
  assert.equal(active.last_completed_at,source.last_completed_at);
  assert.equal(active.recurrence_timezone,source.recurrence_timezone);
  assert.equal(active.stream_id,'old-stream');
  assert.equal(displayStreamId(active),'old-stream');
  assert.equal(displayStreamId(archived),'new-stream');
});

test('archive placement follows source stream and thus its current area filter', () => {
  const cards = hydrateRecurringCards([{...base,status:'complete',completed_at:now.toISOString()}],[source]);
  assert.equal(cardsForStream(cards,'new-stream','archive','month',now).length,1);
  assert.equal(cardsForStream(cards,'old-stream','archive','month',now).length,0);
  assert.equal(cardsForStream(cards,'new-stream','all','month',now).length,1);
});

test('archive period uses completed_at, preserves unknown dates in All time, and sorts newest first', () => {
  const cards = [
    {...base,id:'recent',status:'complete',completed_at:'2026-10-14T00:00:00Z'},
    {...base,id:'year',status:'canceled',completed_at:'2026-03-01T00:00:00Z'},
    {...base,id:'old',status:'complete',completed_at:'2020-01-01T00:00:00Z'},
    {...base,id:'unknown',status:'complete',completed_at:null},
    {...base,id:'active',status:'waiting',completed_at:null},
  ];
  const list = period => cardsForStream(cards,'old-stream','archive',period,now).map(c=>c.id);
  assert.deepEqual(list('month'),['recent']);
  assert.deepEqual(list('year'),['recent','year']);
  assert.deepEqual(list('all'),['recent','year','old','unknown']);
  assert.equal(cardsForStream(cards,'old-stream','all','month',now).length,5);
});

test('archive month cutoff clamps month ends and includes the exact cutoff instant', () => {
  const end = new Date(2026, 2, 31, 12);
  const boundary = new Date(2026, 1, 28, 12);
  const cards = [
    {...base,id:'boundary',status:'complete',completed_at:boundary.toISOString()},
    {...base,id:'before',status:'complete',completed_at:new Date(boundary.getTime() - 1).toISOString()},
  ];
  assert.deepEqual(cardsForStream(cards,'old-stream','archive','month',end).map(c=>c.id),['boundary']);
});

test('archive groups by source identity, preserving individual occurrences and separate same-title sources', () => {
  const cards = hydrateRecurringCards([
    {...base,id:'a',status:'complete'}, {...base,id:'b',status:'complete'},
    {...base,id:'c',status:'complete',recurrence_source_id:'different'},
    {...base,id:'ordinary',status:'complete',recurrence_source_id:null},
  ],[source,{...source,id:'different'}]);
  const groups = archiveGroups(cards);
  assert.equal(groups.length,3);
  assert.deepEqual(groups[0].cards.map(c=>c.id),['a','b']);
  const html = renderToStaticMarkup(React.createElement(ArchiveCards,{cards,status:'complete',renderCard:c=>React.createElement('article',{key:c.id},c.id)}));
  assert.equal((html.match(/<details/g)||[]).length,2);
  assert.ok(html.includes('2 completed'));
  assert.equal((html.match(/<article/g)||[]).length,4);
});

test('Backlog includes Research, while Active and Archive have their designed status columns', () => {
  assert.deepEqual(statusesForView('backlog'),['backlog','priority_backlog','research']);
  assert.equal(cardsForStream([{...base,status:'research'}],'old-stream','backlog','month',now).length,1);
  assert.deepEqual(statusesForView('activated'),['research','waiting','in_progress','review']);
  assert.deepEqual(statusesForView('archive'),['complete','canceled']);
});

test('recurring due badges compare calendar days in the source timezone', () => {
  const card = {...base,recurrence_timezone:'America/New_York'};
  assert.deepEqual(dueBadge(card,now),{kind:'today',label:'Today'});
  assert.equal(dueBadge(card,new Date('2026-10-16T16:00:00Z')).kind,'overdue');
  assert.equal(dueBadge(card,new Date('2026-10-15T02:00:00Z')).kind,'future');
  assert.equal(dueBadge({...card,status:'complete'},now),undefined);
  assert.equal(dueBadge({...card,status:'canceled'},now),undefined);
});

test('rendered active cards show last completion while terminal cards hide due, reminders, and last-completed metadata', () => {
  const today = new Date(); today.setHours(0,0,0,0);
  const card = {...base,due_at:today.toISOString(),remind_at:today.toISOString(),last_completed_at:source.last_completed_at};
  const active = renderToStaticMarkup(React.createElement(CardView,{card}));
  assert.ok(active.includes('badge-today'));
  assert.ok(!active.includes('badge-overdue'));
  assert.ok(active.includes('Last completed on'));
  assert.ok(active.includes('Has reminder'));
  for (const status of ['complete','canceled']) {
    const terminal = renderToStaticMarkup(React.createElement(CardView,{card:{...card,status,completed_at:now.toISOString()}}));
    assert.ok(!terminal.includes('badge-'));
    assert.ok(!terminal.includes('Has reminder'));
    assert.ok(!terminal.includes('Last completed on'));
    assert.ok(terminal.includes(status === 'complete' ? 'Completed' : 'Canceled'));
  }
});

test('datetime-local round trips preserve unchanged instants, seconds, and DST repeated hours across timezones', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['America/New_York','America/Los_Angeles','Asia/Kolkata','Pacific/Auckland','UTC']) {
      process.env.TZ = timezone;
      for (const instant of ['2026-10-15T04:00:42.123Z','2026-11-01T05:30:00.000Z','2026-11-01T06:30:00.000Z']) {
        assert.equal(dateTimeInstant(dateTimeLocal(instant),instant),instant,timezone);
      }
    }
    process.env.TZ = 'America/New_York';
    assert.equal(dateTimeLocal('2026-10-15T04:00:00Z'),'2026-10-15T00:00');
    assert.equal(dateTimeInstant('2026-10-15T02:15','2026-10-15T04:00:00Z'),'2026-10-15T06:15:00.000Z');
    assert.equal(dateTimeInstant('',base.due_at),null);
    assert.equal(dateTimeLocal(null),'');
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('legacy stopped sources with null timezone metadata render pending cards without crashing', () => {
  const [card] = hydrateRecurringCards([base],[{...source,stopped_at:now.toISOString(),recurrence_timezone:null,last_completed_at:null}]);
  assert.equal(card.recurrence_timezone,undefined);
  assert.equal(card.last_completed_at,undefined);
  assert.doesNotThrow(()=>dueBadge(card,now));
  assert.doesNotThrow(()=>renderToStaticMarkup(React.createElement(CardView,{card})));
});

test('calendar day changes use local midnight by default and preserve explicit or relative reminder times', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland']) {
      process.env.TZ = timezone;
      const value = withCalendarDay('', '2026-03-08');
      assert.equal(value, '2026-03-08T00:00');
      const stored = dateTimeInstant(value);
      assert.equal(dateTimeLocal(stored), value, timezone);
      assert.equal(withCalendarDay('2026-03-07T10:30', '2026-03-08'), '2026-03-08T10:30');
      assert.equal(withCalendarDay('', '2026-03-08', '10:30'), '2026-03-08T10:30');
      assert.equal(withCalendarDay('2026-03-07T14:15', '2026-03-08', '10:30'), '2026-03-08T14:15');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('recurring history sorts newest first without mutating card order or combining same-title sources', () => {
  const cards = [
    {...base,id:'unknown',status:'complete',completed_at:null},
    {...base,id:'old',status:'complete',completed_at:'2020-01-01T00:00:00Z'},
    {...base,id:'ordinary',status:'complete',recurrence_source_id:null},
    {...base,id:'recent',status:'complete',completed_at:'2026-10-14T00:00:00Z'},
    {...base,id:'other-source',status:'complete',recurrence_source_id:'other'},
  ];
  const groups=archiveGroups(cards);
  assert.deepEqual(groups[0].cards.map(card=>card.id),['recent','old','unknown']);
  assert.deepEqual(groups.slice(1).map(group=>group.cards.map(card=>card.id)),[['ordinary'],['other-source']]);
  assert.deepEqual(cards.map(card=>card.id),['unknown','old','ordinary','recent','other-source']);
});

test('terminal history counts reflect view filters, keep statuses separate, and start collapsed even for one occurrence', () => {
  const cards=hydrateRecurringCards([
    {...base,id:'recent',status:'complete',completed_at:now.toISOString()},
    {...base,id:'old',status:'complete',completed_at:'2020-01-01T00:00:00Z'},
    {...base,id:'canceled',status:'canceled',completed_at:now.toISOString()},
    {...base,id:'pending',status:'waiting'},
    {...base,id:'ordinary',status:'complete',recurrence_source_id:null,stream_id:'new-stream',completed_at:now.toISOString()},
  ],[source]);
  const render=(view,status)=>renderToStaticMarkup(React.createElement(ArchiveCards,{
    cards:cardsForStream(cards,'new-stream',view,'month',now).filter(card=>card.status===status),status,
    renderCard:card=>React.createElement('article',{key:card.id},card.id),
  }));
  for(const [view,status,count] of [['all','complete',2],['archive','complete',1],['all','canceled',1],['archive','canceled',1]]) {
    const html=render(view,status);
    assert.ok(html.includes(`${count} ${status==='complete'?'completed':'canceled'}`));
    assert.equal((html.match(/<details/g)||[]).length,1);
    assert.doesNotMatch(html,/<details[^>]*\sopen(?:[=>\s])/);
    assert.ok(!html.includes('pending'));
    if(status==='complete') assert.ok(html.includes('<article>ordinary</article>'));
  }
});
