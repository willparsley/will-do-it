import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';

let db;
const user = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const stream = '00000000-0000-0000-0000-000000000003';
const source = '00000000-0000-0000-0000-000000000004';
const original = '00000000-0000-0000-0000-000000000005';
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const generate = async (timezone = 'America/New_York') =>
  (await query('select public.generate_recurring_instances($1) as count', [timezone]))[0].count;
const instances = () => query('select *, recurrence_date::text as day from cards where recurrence_date is not null order by recurrence_date');
const recurrenceSettings = async () => (await query('select * from recurrence_sources where id = $1', [source]))[0];
async function editRecurrence(changes, expected) {
  const settings = expected || await recurrenceSettings();
  return (await query('select * from public.save_recurrence($1,$2,$3::jsonb,$4)',
    [source, settings.updated_at, JSON.stringify(changes), 'America/New_York']))[0];
}

before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated;
    grant usage on schema auth, public to authenticated;
    grant select on auth.users to authenticated;`);
  const schema = (await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'))
    .replace('create extension if not exists "uuid-ossp";', '')
    .replaceAll('uuid_generate_v4()', 'gen_random_uuid()');
  await db.exec(schema);
  const migrations = await readdir(new URL('../supabase/migrations/', import.meta.url));
  for (const name of migrations.filter(name => name.endsWith('.sql')).sort()) {
    const migration = await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Each migration can be reapplied safely.
  }
  await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated');
});

beforeEach(async () => {
  await db.exec('reset role; truncate cards, recurrence_sources, streams, auth.users cascade');
  await query('insert into auth.users values ($1), ($2)', [user, other]);
  await query("insert into streams (id, user_id, title, state, area) values ($1, $2, 'Health', 'in_progress', 'personal')", [stream, user]);
  await query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
});
after(async () => { await db.close(); });

async function fixture({ stack = false, daysAgo = 0, active = false, frequency = 'daily', interval = 1, monthDay = null, weekdays = null } = {}) {
  await query(`insert into recurrence_sources
    (id, user_id, stream_id, base_title, frequency, interval, stack_missed, created_at, month_day, weekdays)
    values ($1, $2, $3, 'Take a walk', $4, $5, $6, now() - make_interval(days => $7), $8, $9)`,
  [source, user, stream, frequency, interval, stack, daysAgo + 5, monthDay, weekdays]);
  // Seed pre-migration cards: these deliberately have no occurrence keys.
  await db.exec('alter table cards disable trigger cards_recurring_insert');
  await query(`insert into cards (id, user_id, stream_id, title, status, is_recurring,
    recurrence_source_id, completed_at, due_at, remind_at)
    values ($1, $2, $3, 'Take a walk', $4, true, $5,
      case when $4 = 'complete' then now() - make_interval(days => $6) end,
      now() - make_interval(days => $6), now())`,
  [original, user, stream, active ? 'in_progress' : 'complete', source, daysAgo]);
  await db.exec('alter table cards enable trigger cards_recurring_insert; set role authenticated');
}

test('daily completion produces one tomorrow backlog card; repeated and overlapping submissions are idempotent', async () => {
  await fixture();
  assert.deepEqual(await Promise.all([generate(), generate()]), [1, 0]);
  assert.equal(await generate(), 0);
  const [card] = await instances();
  assert.equal(card.status, 'backlog');
  assert.equal(card.day, (await query("select ((now() at time zone 'America/New_York')::date + 1)::text as day"))[0].day);
  assert.equal((await query('select count(*)::integer as count from cards'))[0].count, 2);
});

test('recurrence edits update pending cards while preserving occurrence identity and future generation uses the new title and interval', async () => {
  await fixture({ active: true });
  await generate();
  const before = await query('select * from cards order by id');
  const settings = await recurrenceSettings();
  const edited = await editRecurrence({ base_title: 'Long walk', frequency: 'every_n_days', interval: 3 });
  assert.equal(edited.base_title, 'Long walk');
  assert.equal(edited.schedule_revision, settings.schedule_revision + 1);
  const [pending] = await query('select * from cards order by id');
  assert.equal(pending.id, before[0].id);
  assert.deepEqual(pending.recurrence_date, before[0].recurrence_date);
  assert.equal(pending.status, 'in_progress');
  assert.ok(pending.title.startsWith('Long walk - '));
  assert.ok(pending.due_at > before[0].due_at);
  await saveCard(original, 'in_progress', { status: 'complete' });
  assert.equal(await generate(), 1);
  const [next] = await instances();
  assert.ok(next.title.startsWith('Long walk - '));
  assert.equal(next.day, (await query("select ((now() at time zone 'America/New_York')::date + 5)::text as day"))[0].day);
});

test('editing the source stream moves pending siblings while completed history stays intact', async () => {
  await fixture({ stack: true, daysAgo: 3 });
  await generate();
  await addTarget();
  const history = await query('select * from cards where id = $1', [original]);
  await editRecurrence({ stream_id: target, base_title: 'Moved walk' });
  assert.ok((await query("select stream_id from cards where status not in ('complete','canceled')")).every(c => c.stream_id === target));
  assert.deepEqual(await query('select * from cards where id = $1', [original]), history);
});

test('recurrence editor rejects invalid schedules and disabling stacking never deletes extra pending cards', async () => {
  await fixture({ stack: true, daysAgo: 3 });
  await generate();
  const before = await query('select * from cards order by id');
  for (const changes of [{ interval: 0 }, { frequency: 'yearly' }, { weekdays: [7] }, { month_day: 32 }, { base_title: ' ' }, { enabled: null }, { generated_through: '2099-01-01' }]) {
    await assert.rejects(editRecurrence(changes));
  }
  await assert.rejects(editRecurrence({ stack_missed: false }), /extra pending occurrences/);
  assert.deepEqual(await query('select * from cards order by id'), before);
  await query("update cards set status = 'canceled' where status not in ('complete','canceled')");
  assert.equal((await editRecurrence({ stack_missed: false })).stack_missed, false);
});

test('stopping and resuming a recurrence preserves pending cards and the editor uses source-local end dates', async () => {
  await fixture();
  await generate();
  const before = await query('select * from cards order by id');
  await editRecurrence({ enabled: false, end_date: '2026-11-01' });
  assert.equal(await generate(), 0);
  assert.deepEqual(await query('select * from cards order by id'), before);
  assert.equal((await query("select (end_date at time zone recurrence_timezone)::date::text as day from recurrence_sources"))[0].day, '2026-11-01');
  assert.equal((await editRecurrence({ enabled: true, end_date: null })).stopped_at, null);
  assert.equal((await recurrenceSettings()).end_date, null);
});

test('stale recurrence editors cannot overwrite newer edits or source moves; generation does not invalidate an editor', async () => {
  await fixture({ active: true });
  const stale = await recurrenceSettings();
  await generate();
  await editRecurrence({ base_title: 'First edit' }, stale);
  await assert.rejects(editRecurrence({ base_title: 'Stale edit' }, stale), /changed elsewhere/);
  const beforeMove = await recurrenceSettings();
  await addTarget();
  await saveCard(original, 'in_progress', { stream_id: target });
  await assert.rejects(editRecurrence({ stream_id: stream }, beforeMove), /changed elsewhere/);
  assert.equal((await recurrenceSettings()).stream_id, target);
});

test('recurrence editor rejects other-user and inactive targets and requires an active stream to resume', async () => {
  await fixture();
  const settings = await recurrenceSettings();
  await query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
  await assert.rejects(editRecurrence({ base_title: 'Not mine' }, settings), /not found/);
  await query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await saveStream('complete', [{ source_id: source, action: 'stop' }]);
  await assert.rejects(editRecurrence({ enabled: true }), /active stream/);
  assert.equal((await editRecurrence({ base_title: 'Stopped walk', enabled: false })).base_title, 'Stopped walk');
  await addTarget();
  assert.equal((await editRecurrence({ enabled: true, stream_id: target })).stopped_at, null);
});

test('moving a monthly date reschedules auto-promoted Waiting, restores priority backlog, and reserves the new month slot', async () => {
  await fixture({ active: true, frequency: 'monthly' });
  const [{ day, last, due }] = await query(`select extract(day from now() at time zone 'America/New_York')::integer as day,
    extract(day from date_trunc('month', now() at time zone 'America/New_York') + interval '1 month - 1 day')::integer as last,
    ((now() at time zone 'America/New_York')::date + time '09:00') at time zone 'America/New_York' as due`);
  await query('update recurrence_sources set month_day = $1, created_at = now(), recurrence_timezone = $2', [day, 'America/New_York']);
  await query("update cards set status = 'priority_backlog', due_at = $1, remind_at = null where id = $2", [due, original]);
  await query("select promote_due_cards('America/New_York')");
  let [card] = await query('select * from cards where id = $1', [original]);
  assert.equal(card.status, 'waiting');
  assert.equal(card.auto_promoted_from, 'priority_backlog');
  const identity = card.recurrence_date;
  const edited = await editRecurrence({ month_day: day < last ? day + 1 : 1, interval: day < last ? 1 : 2 });
  [card] = await query('select * from cards where id = $1', [original]);
  assert.equal(card.status, 'priority_backlog');
  assert.equal(card.auto_promoted_from, null);
  assert.deepEqual(card.recurrence_date, identity);
  assert.ok(card.due_at > due);
  assert.equal(edited.schedule_revision, 2);
  assert.equal(await generate(), 0);
  assert.equal((await query('select count(*)::integer as count from cards'))[0].count, 1);
  // Once that occurrence is completed, the next one belongs to a later month.
  await saveCard(original, card.status, { status: 'complete' });
  assert.equal(await generate(), 1);
  const [{ old_month, new_month }] = await query(`select
    date_trunc('month', a.scheduled_date)::date as old_month,
    date_trunc('month', b.scheduled_date)::date as new_month
    from cards a join cards b on b.id <> a.id where a.id = $1`, [original]);
  assert.ok(new_month > old_month);
});

test('manual status changes clear promotion provenance and recurrence edits preserve manually chosen statuses', async () => {
  await fixture({ active: true });
  await query("update cards set status = 'backlog', remind_at = null where id = $1", [original]);
  await query("select promote_due_cards('America/New_York')");
  assert.equal((await query('select auto_promoted_from from cards'))[0].auto_promoted_from, 'backlog');
  await saveCard(original, 'waiting', { status: 'research' });
  await saveCard(original, 'research', { status: 'waiting' });
  assert.equal((await query('select auto_promoted_from from cards'))[0].auto_promoted_from, null);
  await editRecurrence({ frequency: 'every_n_days', interval: 5 });
  assert.equal((await query('select status from cards'))[0].status, 'waiting');
  await saveCard(original, 'waiting', { status: 'review' });
  await editRecurrence({ interval: 10 });
  assert.equal((await query('select status from cards'))[0].status, 'review');
});

test('initial and catch-up generated Waiting cards record automatic promotion without marking manual Waiting', async () => {
  await db.exec('set role authenticated');
  const auto = await createRecurring({ status: 'priority_backlog' });
  assert.equal(auto.status, 'waiting');
  assert.equal(auto.auto_promoted_from, 'priority_backlog');
  const manual = await createRecurring({ status: 'waiting', title: 'Manual' });
  assert.equal(manual.auto_promoted_from, null);
  // A stacking source catches up missed dates with an automatic origin too.
  await db.exec('reset role');
  await fixture({ stack: true, daysAgo: 2 });
  await generate();
  const missed = await query("select auto_promoted_from from cards where recurrence_source_id = $1 and status = 'waiting'", [source]);
  assert.ok(missed.length > 0);
  assert.ok(missed.every(card => card.auto_promoted_from === 'backlog'));
});

test('pending rescheduling preserves reminder offsets and local times across daylight saving changes', async () => {
  await fixture({ active: true, frequency: 'monthly', monthDay: 1 });
  await query("update recurrence_sources set recurrence_timezone = 'America/New_York', generated_through = '2026-11-01'");
  await query("update cards set due_at = '2026-11-01T14:00:00Z', remind_at = '2026-10-31T12:00:00Z' where id = $1", [original]);
  await editRecurrence({ month_day: 5 });
  const [card] = await query("select (due_at at time zone 'America/New_York')::text as due, (remind_at at time zone 'America/New_York')::text as reminder, status from cards");
  assert.equal(card.due, '2026-11-05 09:00:00');
  assert.equal(card.reminder, '2026-11-04 08:00:00');
  assert.equal(card.status, 'in_progress');
});

test('schedule edits preserve complete and canceled rows byte for byte, including occurrence identities', async () => {
  await fixture({ stack: true, daysAgo: 3 });
  await generate();
  const [pending] = await instances();
  await saveCard(pending.id, pending.status, { status: 'canceled' });
  const terminal = await query("select * from cards where status in ('complete','canceled') order by id");
  await editRecurrence({ frequency: 'monthly', month_day: -1, base_title: 'Monthly walk' });
  assert.deepEqual(await query("select * from cards where status in ('complete','canceled') order by id"), terminal);
  assert.ok((await query("select scheduled_date from cards where status not in ('complete','canceled')")).every(c => c.scheduled_date));
  assert.equal(await generate(), 0);
});

test('rescheduling an automatic Waiting card does not demote it while a reminder is still due', async () => {
  await fixture({ active: true });
  await query("update cards set status = 'backlog', remind_at = now() - interval '20 days'");
  await query("select promote_due_cards('America/New_York')");
  await editRecurrence({ frequency: 'every_n_days', interval: 5 });
  const [card] = await query('select status, auto_promoted_from from cards');
  assert.equal(card.status, 'waiting');
  assert.equal(card.auto_promoted_from, 'backlog');
});

test('moving a pending monthly backlog to an arrived date promotes it and future generation never duplicates its new date', async () => {
  await fixture({ active: true, frequency: 'monthly', monthDay: -1 });
  await query("update recurrence_sources set recurrence_timezone = 'America/New_York'");
  await query(`update cards set status = 'priority_backlog', remind_at = null,
    due_at = (date_trunc('month', now() at time zone 'America/New_York') + interval '1 month - 1 day') at time zone 'America/New_York'`);
  await editRecurrence({ month_day: 1 });
  const [card] = await query('select * from cards');
  assert.equal(card.status, 'waiting');
  assert.equal(card.auto_promoted_from, 'priority_backlog');
  assert.equal(await generate(), 0);
  await saveCard(original, 'waiting', { status: 'complete' });
  assert.equal((await query('select auto_promoted_from from cards'))[0].auto_promoted_from, null);
  assert.equal(await generate(), 1);
  assert.equal(await generate(), 0);
});

test('new schedule revisions permit previously used identity dates without changing old identities', async () => {
  await fixture({ stack: true, daysAgo: 4 });
  await generate();
  const identities = await query('select id, recurrence_date, recurrence_revision from cards order by id');
  await editRecurrence({ frequency: 'every_n_days', interval: 2 });
  await editRecurrence({ frequency: 'daily', interval: 1 });
  assert.deepEqual(await query('select id, recurrence_date, recurrence_revision from cards order by id'), identities);
  const dates = await query("select scheduled_date from cards where status not in ('complete','canceled') order by scheduled_date");
  assert.equal(new Set(dates.map(c=>String(c.scheduled_date))).size, dates.length);
  assert.equal(await generate(), 0);
  await assert.rejects(query('update cards set recurrence_revision = recurrence_revision + 1 where id = $1', [identities[0].id]), /cannot change its recurrence identity/);
});

test('an active original blocks non-stacking generation, then status-only completion immediately permits generation', async () => {
  await fixture({ active: true });
  assert.equal(await generate(), 0);
  const [completed] = await query("update cards set status = 'complete' where id = $1 returning *", [original]);
  assert.ok(completed.completed_at);
  assert.equal(completed.remind_at, null);
  assert.deepEqual((await query('select last_completed_at from recurrence_sources'))[0].last_completed_at, completed.completed_at);
  assert.equal(await generate(), 1);
  assert.equal(await generate(), 0);
});

test('stacking catches up distinct missed dates and keeps only one future instance', async () => {
  await fixture({ stack: true, daysAgo: 3 });
  assert.equal(await generate(), 4);
  assert.equal(await generate(), 0);
  const cards = await instances();
  assert.equal(new Set(cards.map(c => c.day)).size, 4);
  assert.deepEqual(cards.map(c => c.status), ['waiting', 'waiting', 'waiting', 'backlog']);
  await query("update cards set status = 'complete' where id = $1", [cards[0].id]);
  assert.equal(await generate(), 0);
});

test('non-stacking creates only one missed instance while it remains pending', async () => {
  await fixture({ daysAgo: 5 });
  assert.equal(await generate(), 1);
  assert.equal((await instances())[0].status, 'waiting');
  assert.equal(await generate(), 0);
  await query("update cards set status = 'complete' where recurrence_date is not null");
  assert.equal(await generate(), 1);
  assert.equal((await instances())[1].status, 'backlog');
});

test('occurrence identity survives due-date edits and deletion; the same period is never regenerated', async () => {
  await fixture({ stack: true });
  await generate();
  const [card] = await instances();
  await query("update cards set due_at = now() + interval '10 days' where id = $1", [card.id]);
  assert.equal(await generate('Pacific/Honolulu'), 0);
  await query('delete from cards where id = $1', [card.id]);
  assert.equal(await generate(), 0);
});

test('database uniqueness rejects a duplicate scheduled occurrence', async () => {
  await fixture();
  await generate();
  await assert.rejects(query(`insert into cards (user_id, stream_id, title, status, recurrence_source_id, recurrence_date)
    select user_id, stream_id, title, 'complete', recurrence_source_id, recurrence_date
    from cards where recurrence_date is not null`), /duplicate key/);
});

test('legacy duplicate cards remain intact and block additional non-stacking cards', async () => {
  await fixture({ active: true });
  await db.exec('reset role; alter table cards disable trigger cards_recurring_insert');
  await query(`insert into cards (user_id, stream_id, title, status, is_recurring, recurrence_source_id, due_at)
    select user_id, stream_id, title, status, is_recurring, recurrence_source_id, due_at from cards`);
  await db.exec('alter table cards enable trigger cards_recurring_insert; set role authenticated');
  assert.equal(await generate(), 0);
  assert.equal((await query('select count(*)::integer as count from cards'))[0].count, 2);
});

test('cancellation stamps archive time, clears reminder, and reopening clears completion', async () => {
  await fixture({ active: true });
  const [card] = await query("update cards set status = 'canceled' where id = $1 returning *", [original]);
  assert.ok(card.completed_at);
  assert.equal(card.remind_at, null);
  assert.equal((await query('select last_completed_at from recurrence_sources'))[0].last_completed_at, null);
  await query("update cards set status = 'waiting' where id = $1", [original]);
  assert.equal((await query('select completed_at from cards'))[0].completed_at, null);
  assert.equal(await generate(), 0);
});

test('stopped sources and passed end dates do not generate', async () => {
  await fixture();
  await query('update recurrence_sources set stopped_at = now()');
  assert.equal(await generate(), 0);
  await query("update recurrence_sources set stopped_at = null, end_date = now() - interval '1 day'");
  assert.equal(await generate(), 0);
});

test('RLS limits generation to the authenticated owner; anonymous calls fail', async () => {
  await fixture();
  await query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
  assert.equal(await generate(), 0);
  assert.equal((await query('select * from cards')).length, 0);
  await query("select set_config('request.jwt.claim.sub', '', false)");
  await assert.rejects(generate(), /Not authenticated/);
});

test('monthly last-day and clamping, weekday selection and multi-week interval use calendar dates', async () => {
  await fixture();
  const next = async (after, frequency, interval, monthDay, weekdays = null) =>
    (await query(`select public.next_recurrence_date($1::date,
      jsonb_populate_record(null::public.recurrence_sources, jsonb_build_object(
        'created_at', '2026-01-05T12:00:00Z', 'recurrence_timezone', 'America/New_York',
        'frequency', $2::text, 'interval', $3::integer, 'month_day', $4::integer, 'weekdays', $5::jsonb)))::text as day`,
    [after, frequency, interval, monthDay, weekdays]))[0].day;
  assert.equal(await next('2026-01-31', 'monthly', 1, 31), '2026-02-28');
  assert.equal(await next('2026-02-28', 'monthly', 1, 31), '2026-03-31');
  assert.equal(await next('2028-01-31', 'monthly', 1, -1), '2028-02-29');
  assert.equal(await next('2026-01-05', 'weekly', 1, null, '[1,3,5]'), '2026-01-07');
  assert.equal(await next('2026-01-09', 'weekly', 2, null, '[1,3,5]'), '2026-01-19');
  assert.equal(await next('2026-01-31', 'monthly', 2, 31), '2026-03-31');
});

test('timezone pins occurrence dates across devices and daylight saving changes', async () => {
  await fixture();
  await generate('America/New_York');
  assert.equal(await generate('Pacific/Auckland'), 0);
  assert.equal((await query('select recurrence_timezone from recurrence_sources'))[0].recurrence_timezone, 'America/New_York');
  const [row] = await query(`select
    extract(epoch from ('2026-03-09'::date::timestamp at time zone 'America/New_York') -
      ('2026-03-08'::date::timestamp at time zone 'America/New_York')) / 3600 as hours`);
  assert.equal(Number(row.hours), 23);
  await assert.rejects(generate('invalid/timezone'), /Invalid timezone/);
});

test('repeated completion requests preserve timestamps and cannot generate a second pending card', async () => {
  await fixture({ active: true });
  const [first] = await query("update cards set status = 'complete' where id = $1 returning completed_at", [original]);
  await generate();
  const [second] = await query("update cards set status = 'complete' where id = $1 returning completed_at", [original]);
  assert.deepEqual(first.completed_at, second.completed_at);
  assert.equal(await generate(), 0);
  assert.equal((await instances()).length, 1);
});

test('every-N-days respects its interval', async () => {
  await fixture({ frequency: 'every_n_days', interval: 3 });
  assert.equal(await generate(), 1);
  assert.equal((await instances())[0].day,
    (await query("select ((now() at time zone 'America/New_York')::date + 3)::text as day"))[0].day);
});

test('sources awaiting their first manual card do not race creation', async () => {
  await fixture();
  await query('delete from cards');
  assert.equal(await generate(), 0);
});

test('duplicate audit is read-only and finds legacy pending copies', async () => {
  await fixture({ active: true });
  await db.exec('reset role; alter table cards disable trigger cards_recurring_insert');
  await query(`insert into cards (user_id, stream_id, title, status, recurrence_source_id, due_at)
    select user_id, stream_id, title, status, recurrence_source_id, due_at from cards`);
  await db.exec('alter table cards enable trigger cards_recurring_insert; set role authenticated');
  const audit = await readFile(new URL('../supabase/audit_recurrence_duplicates.sql', import.meta.url), 'utf8');
  const results = await db.exec(audit);
  assert.equal(results[0].rows.length, 1);
  assert.equal(results[1].rows.length, 1);
  assert.equal((await query('select count(*)::integer as count from cards'))[0].count, 2);
});

test('older clients cannot bypass non-stacking guard with unkeyed inserts', async () => {
  await fixture();
  await generate();
  await assert.rejects(query(`insert into cards (user_id, stream_id, title, status, is_recurring, recurrence_source_id, due_at)
    values ($1, $2, 'Legacy generated copy', 'backlog', true, $3, now() + interval '1 day')`,
  [user, stream, source]), /already has a pending card/);
});

test('older stacking clients get an occurrence key and cannot duplicate a date', async () => {
  await fixture({ stack: true });
  await generate();
  await assert.rejects(query(`insert into cards (user_id, stream_id, title, status, is_recurring, recurrence_source_id, due_at)
    select user_id, stream_id, 'Legacy generated copy', status, true, recurrence_source_id, due_at
    from cards where recurrence_date is not null`), /duplicate key/);
});

const target = '00000000-0000-0000-0000-000000000006';
async function addTarget(state = 'in_progress') {
  await query("insert into streams (id, user_id, title, state, area) values ($1, $2, 'Target', $3, 'personal')", [target, user, state]);
}
const promote = () => query("select public.promote_due_cards('America/New_York') as count");

test('non-stacking rejects reopening an old occurrence while its successor is pending', async () => {
  await fixture();
  await generate();
  await assert.rejects(query("update cards set status = 'waiting' where id = $1", [original]), /already has a pending card/);
  assert.equal((await query('select status from cards where id = $1', [original]))[0].status, 'complete');
});

test('promotion cannot resurrect a completed card after another tab read its old status', async () => {
  await fixture({ active: true });
  await query("update cards set status = 'backlog' where id = $1", [original]);
  const snapshot = await query('select * from cards where id = $1', [original]);
  assert.equal(snapshot[0].status, 'backlog');
  await query("update cards set status = 'complete' where id = $1", [original]);
  await generate();
  await promote();
  const [persisted] = await query('select * from cards where id = $1', [original]);
  assert.equal(persisted.status, 'complete');
  assert.ok(persisted.completed_at);
});

test('promotion catches up overdue recurring and ordinary backlogs without advancing other active statuses', async () => {
  await fixture({ active: true, daysAgo: 2 });
  await query("update cards set status = 'backlog' where id = $1", [original]);
  await query("insert into cards (user_id, stream_id, title, status, due_at) values ($1,$2,'Ordinary overdue','backlog',now() - interval '2 days')", [user, stream]);
  assert.equal((await promote())[0].count, 2);
  assert.equal((await query('select status from cards where id = $1', [original]))[0].status, 'waiting');
  await query("update cards set status = 'in_progress' where id = $1", [original]);
  assert.equal((await promote())[0].count, 0);
  assert.equal((await query("select status from cards where title = 'Ordinary overdue'"))[0].status, 'waiting');
});

test('ordinary reminders still promote on their day, with future cards left alone', async () => {
  await fixture({ active: true });
  await query("update cards set due_at = null, remind_at = null where id = $1", [original]);
  await query(`insert into cards (user_id, stream_id, title, status, remind_at) values
    ($1,$2,'Today','priority_backlog',now()), ($1,$2,'Future','backlog',now() + interval '3 days')`, [user, stream]);
  assert.equal((await promote())[0].count, 1);
  assert.equal((await query("select status from cards where title = 'Today'"))[0].status, 'waiting');
  assert.equal((await query("select status from cards where title = 'Future'"))[0].status, 'backlog');
});

test('stream rehome preserves all cards, timestamps, and sources before deleting the stream', async () => {
  await fixture({ stack: true, daysAgo: 2 });
  await generate();
  await addTarget();
  const before = await query('select id, completed_at from cards order by id');
  await query('select public.delete_stream_rehoming($1,$2)', [stream, target]);
  assert.equal((await query('select * from streams where id = $1', [stream])).length, 0);
  assert.ok((await query('select stream_id from cards')).every(c => c.stream_id === target));
  assert.equal((await query('select stream_id from recurrence_sources'))[0].stream_id, target);
  assert.deepEqual(await query('select id, completed_at from cards order by id'), before);
});

test('a failed rehome rolls back source movement and keeps the original stream and history', async () => {
  await fixture();
  await addTarget();
  await db.exec(`reset role;
    create or replace function public.test_rehome_failure() returns trigger language plpgsql as
      $$ begin raise exception 'Simulated rehome failure'; end $$;
    create trigger test_rehome_failure before update of stream_id on cards for each row execute function public.test_rehome_failure();
    set role authenticated;`);
  await assert.rejects(query('select public.delete_stream_rehoming($1,$2)', [stream, target]), /Simulated rehome failure/);
  assert.equal((await query('select stream_id from recurrence_sources'))[0].stream_id, stream);
  assert.equal((await query('select stream_id from cards'))[0].stream_id, stream);
  assert.equal((await query('select id from streams where id = $1', [stream])).length, 1);
  await db.exec('reset role; drop trigger test_rehome_failure on cards; drop function public.test_rehome_failure(); set role authenticated');
});

test('direct deletion cannot cascade-delete card history; invalid and inactive targets are rejected', async () => {
  await fixture();
  await assert.rejects(query('delete from streams where id = $1', [stream]), /foreign key constraint/);
  await addTarget('complete');
  await assert.rejects(query('select public.delete_stream_rehoming($1,$2)', [stream, target]), /active stream/);
  await assert.rejects(query('select public.delete_stream_rehoming($1,$2)', [stream, stream]), /active stream/);
  assert.equal((await query('select * from cards')).length, 1);
});

test('occurrence identity cannot be edited even when due_at can', async () => {
  await fixture();
  await generate();
  await assert.rejects(query("update cards set recurrence_date = recurrence_date + 1 where recurrence_date is not null"), /cannot change its recurrence identity/);
});

const saveCard = async (id, status, changes) =>
  (await query('select row_to_json(public.save_card($1,$2,$3)) as card', [id, JSON.stringify(changes), status]))[0].card;
const saveStream = (state, decisions = [], area = 'personal') => query(
  "select row_to_json(public.save_stream($1,'Health',$2,null,$3,$4)) as stream",
  [stream, area, state, JSON.stringify(decisions)]);
const closingSources = () => query("select id from public.recurrences_for_stream($1,'America/New_York')", [stream]);
const createRecurring = async ({ frequency = 'daily', interval = 1, weekdays = null, monthDay = null, due = null, stack = false, title = 'New recurrence', status = 'backlog' } = {}) =>
  (await query(`select row_to_json(public.create_recurring_card($1,$2,$3,$4,null,$5,$6,$7,$8,$9,'America/New_York')) as card`,
    [title, stream, status, due, frequency, interval, weekdays === null ? null : JSON.stringify(weekdays), monthDay, stack]))[0].card;

test('first stacking generation catches up after late completion instead of resetting its schedule', async () => {
  await fixture({ stack: true, daysAgo: 3, active: true });
  await saveCard(original, 'in_progress', { status: 'complete' });
  assert.equal(await generate(), 4);
  assert.deepEqual((await instances()).map(c => c.status), ['waiting','waiting','waiting','backlog']);
});

test('legacy stacking scans holes but never duplicates already recorded dates', async () => {
  await fixture({ stack: true, daysAgo: 3 });
  await query(`insert into cards (user_id,stream_id,title,status,is_recurring,recurrence_source_id,due_at,completed_at)
    values ($1,$2,'Existing later occurrence','complete',true,$3,now() - interval '1 day',now() - interval '1 day')`, [user,stream,source]);
  assert.equal(await generate(), 3); // -2, today, tomorrow; -1 already exists.
  assert.equal(await generate(), 0);
  assert.equal((await query("select * from cards where status not in ('complete','canceled')")).length, 3);
});

test('moving a recurring card moves all pending siblings and leaves completed storage intact', async () => {
  await fixture({ stack: true, daysAgo: 3 });
  await generate();
  await addTarget();
  const [dragged] = await instances();
  await saveCard(dragged.id, dragged.status, { stream_id: target });
  assert.ok((await query("select stream_id from cards where status not in ('complete','canceled')")).every(c => c.stream_id === target));
  assert.equal((await query('select stream_id from recurrence_sources'))[0].stream_id, target);
  assert.equal((await query('select stream_id from cards where id = $1', [original]))[0].stream_id, stream);
});

test('direct source movement also moves pending cards atomically for older clients', async () => {
  await fixture({ stack: true, daysAgo: 2 });
  await generate();
  await addTarget();
  await query('update recurrence_sources set stream_id = $1 where id = $2', [target,source]);
  assert.ok((await query("select stream_id from cards where status <> 'complete'")).every(c => c.stream_id === target));
});

test('stale card actions fail without overwriting a completed status or its timestamp', async () => {
  await fixture();
  const before = (await query('select completed_at from cards where id = $1', [original]))[0].completed_at;
  await assert.rejects(saveCard(original, 'in_progress', { status: 'waiting' }), /changed elsewhere/);
  assert.deepEqual((await query('select completed_at from cards where id = $1', [original]))[0].completed_at, before);
});

test('stream closure detects live sources with no pending cards and requires an explicit choice', async () => {
  await fixture();
  assert.equal((await closingSources()).length, 1);
  await assert.rejects(saveStream('complete'), /Choose move or stop/);
  await assert.rejects(query("update streams set state = 'complete' where id = $1", [stream]), /Choose move or stop/);
  await saveStream('complete', [{ source_id: source, action: 'stop' }]);
  assert.ok((await query('select stopped_at from recurrence_sources'))[0].stopped_at);
  assert.equal(await generate(), 0);
});

test('stream closure supports separate move and stop choices without deleting pending cards', async () => {
  await fixture({ active: true });
  await addTarget();
  const second = await createRecurring({ title: 'Second source' });
  await saveStream('canceled', [
    { source_id: source, action: 'move', stream_id: target },
    { source_id: second.recurrence_source_id, action: 'stop' },
  ]);
  assert.equal((await query('select state from streams where id = $1',[stream]))[0].state, 'canceled');
  assert.equal((await query('select stream_id from cards where id = $1',[original]))[0].stream_id, target);
  assert.equal((await query('select stream_id from cards where id = $1',[second.id]))[0].stream_id, stream);
  assert.ok((await query('select stopped_at from recurrence_sources where id = $1',[second.recurrence_source_id]))[0].stopped_at);
});

test('stream save rolls back recurrence choices when later metadata validation fails', async () => {
  await fixture({ active: true });
  await addTarget();
  await assert.rejects(saveStream('complete', [{ source_id: source, action: 'move', stream_id: target }], 'invalid-area'), /check constraint/);
  assert.equal((await query('select stream_id from recurrence_sources'))[0].stream_id, stream);
  assert.equal((await query('select stream_id from cards'))[0].stream_id, stream);
  assert.equal((await query('select state from streams where id = $1',[stream]))[0].state, 'in_progress');
});

test('ended and stopped sources do not ask for closure choices once their schedules are exhausted', async () => {
  await fixture();
  await query("update recurrence_sources set end_date = now() - interval '1 day'");
  assert.equal((await closingSources()).length, 0);
  await saveStream('complete');
  assert.equal(await generate(), 0);
});

test('generation skips legacy closed streams even if their sources were never stopped', async () => {
  await fixture();
  await db.exec('reset role; alter table streams disable trigger streams_closure');
  await query("update streams set state = 'complete' where id = $1", [stream]);
  await db.exec('alter table streams enable trigger streams_closure; set role authenticated');
  assert.equal(await generate(), 0);
});

test('new daily tasks without a due date are scheduled today and promoted immediately', async () => {
  await db.exec('set role authenticated');
  const card = await createRecurring();
  assert.equal(card.status, 'waiting');
  assert.ok(card.due_at);
  assert.ok(card.recurrence_date);
  assert.equal(await generate(), 0);
});

test('legacy undated pending tasks receive a schedule and catch-up promotion', async () => {
  await fixture({ active: true });
  await query("update cards set due_at = null, status = 'backlog' where id = $1", [original]);
  assert.equal(await generate(), 0);
  await promote();
  const [card] = await query('select * from cards where id = $1',[original]);
  assert.equal(card.status, 'waiting');
  assert.ok(card.due_at);
});

test('new weekly and monthly tasks start on the next matching calendar date', async () => {
  await db.exec('set role authenticated');
  const nextDow = Number((await query("select extract(dow from (now() at time zone 'America/New_York')::date + 2) as dow"))[0].dow);
  const weekly = await createRecurring({ frequency: 'weekly', weekdays: [nextDow] });
  assert.equal(weekly.recurrence_date, (await query("select ((now() at time zone 'America/New_York')::date + 2)::text as day"))[0].day);
  assert.equal(weekly.status, 'backlog');
  const monthly = await createRecurring({ frequency: 'monthly', monthDay: -1 });
  assert.equal(monthly.recurrence_date,
    (await query("select (date_trunc('month', now() at time zone 'America/New_York') + interval '1 month - 1 day')::date::text as day"))[0].day);
});

test('new every-N-days tasks start today, and subsequent periods retain their interval', async () => {
  await db.exec('set role authenticated');
  const card = await createRecurring({ frequency:'every_n_days', interval:3 });
  assert.equal(card.status,'waiting');
  await saveCard(card.id,card.status,{status:'complete'});
  await generate();
  const [next] = await query('select recurrence_date::text as day from cards where id <> $1',[card.id]);
  assert.equal(next.day, (await query("select ((now() at time zone 'America/New_York')::date + 3)::text as day"))[0].day);
});

test('failed recurring creation leaves no orphan source and validates patterns before scheduling', async () => {
  await db.exec('set role authenticated');
  await assert.rejects(createRecurring({ status:'invalid-status' }), /check constraint/);
  assert.equal((await query('select * from recurrence_sources')).length, 0);
  await assert.rejects(createRecurring({ frequency:'weekly', weekdays:[7] }), /Invalid weekdays/);
  await assert.rejects(createRecurring({ frequency:'monthly', monthDay:32 }), /Invalid monthly day/);
  assert.equal((await query('select * from recurrence_sources')).length, 0);
});

test('lifecycle RPCs cannot access another user cards or streams', async () => {
  await fixture({ active:true });
  await query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await assert.rejects(saveCard(original,'in_progress',{status:'complete'}), /Card not found/);
  await assert.rejects(saveStream('complete',[{source_id:source,action:'stop'}]), /Stream not found/);
  await assert.rejects(createRecurring(), /Choose an active stream/);
  assert.equal((await closingSources()).length, 0);
});

test('stacking batches resume at the cursor without losing or duplicating periods', async () => {
  await fixture({stack:true,daysAgo:1001});
  assert.equal(await generate(),1000);
  assert.equal(await generate(),2);
  assert.equal(await generate(),0);
  const days = (await instances()).map(c=>c.day);
  assert.equal(days.length,1002);
  assert.equal(new Set(days).size,1002);
});

test('legacy weekly sources with no timezone still schedule safely', async () => {
  await db.exec('set role authenticated');
  await query(`insert into recurrence_sources (id,user_id,stream_id,base_title,frequency,interval,weekdays)
    values ($1,$2,$3,'Legacy weekly','weekly',1,'[1,3,5]')`, [source,user,stream]);
  await query(`insert into cards (user_id,stream_id,title,status,is_recurring,recurrence_source_id)
    values ($1,$2,'Legacy weekly','backlog',true,$3)`,[user,stream,source]);
  assert.ok((await query('select due_at from cards'))[0].due_at);
});

test('recurrence pattern validation rejects malformed weekdays instead of looping', async () => {
  await fixture();
  await assert.rejects(query(`select public.next_recurrence_date(current_date,
    jsonb_populate_record(null::public.recurrence_sources, '{"frequency":"weekly","weekdays":[7]}'))`), /Invalid weekdays/);
});

test('exhausted legacy stacking history does not produce a false closure warning', async () => {
  await fixture({stack:true,daysAgo:3});
  await db.exec('reset role; alter table cards disable trigger cards_recurring_insert');
  for(const days of [2,1]) await query(`insert into cards (user_id,stream_id,title,status,is_recurring,recurrence_source_id,due_at)
    values ($1,$2,'Recorded occurrence','complete',true,$3,((now() at time zone 'America/New_York')::date - $4::integer)::timestamp at time zone 'America/New_York')`,[user,stream,source,days]);
  await db.exec('alter table cards enable trigger cards_recurring_insert; set role authenticated');
  await query("update recurrence_sources set end_date=now() - interval '1 day'");
  assert.equal((await closingSources()).length,0);
  await saveStream('complete');
});

test('ended stacking schedules with missing periods still require resolution and can catch up to their end date', async () => {
  await fixture({stack:true,daysAgo:3});
  await query("update recurrence_sources set end_date=now() - interval '1 day'");
  assert.equal((await closingSources()).length,1);
  await assert.rejects(saveStream('complete'), /Choose move or stop/);
  assert.equal(await generate(),2);
  assert.ok((await instances()).every(c=>c.status==='waiting'));
  assert.equal((await closingSources()).length,0);
});

for (const recurring of [false, true]) {
  for (const initial of ['backlog', 'priority_backlog', 'research', 'waiting', 'in_progress', 'review', 'complete', 'canceled']) {
    for (const field of ['due_at', 'remind_at']) {
      for (const offset of [-1, 0, 1]) {
        test(`${recurring ? 'recurring' : 'ordinary'} ${initial}: ${field} day ${offset} promotes only an eligible backlog`, async () => {
          const [calendar] = await query("select (((now() at time zone 'America/New_York')::date + $1::integer)::timestamp at time zone 'America/New_York') as instant", [offset]);
          const instant = calendar.instant.toISOString();
          const due = field === 'due_at' ? instant : null;
          const reminder = field === 'remind_at' ? instant : null;
          if (recurring) {
            await fixture({ active: true });
            await query("update recurrence_sources set recurrence_timezone = 'America/New_York' where id = $1", [source]);
            await query('update cards set status = $1, due_at = $2, remind_at = $3 where id = $4', [initial, due, reminder, original]);
          } else {
            await db.exec('set role authenticated');
            await query(`insert into cards (id,user_id,stream_id,title,status,due_at,remind_at)
              values ($1,$2,$3,'Ordinary dated task',$4,$5,$6)`, [original,user,stream,initial,due,reminder]);
          }
          const eligible = ['backlog', 'priority_backlog'].includes(initial) && offset <= 0;
          const before = await query('select completed_at,stream_id,title from cards where id = $1', [original]);
          assert.equal((await promote())[0].count, eligible ? 1 : 0);
          assert.equal((await query('select status from cards where id = $1', [original]))[0].status, eligible ? 'waiting' : initial);
          assert.deepEqual(await query('select completed_at,stream_id,title from cards where id = $1', [original]), before);
          assert.equal((await promote())[0].count, 0);
        });
      }
    }
  }
}

for (const trigger of ['due_at', 'remind_at']) test(`ordinary overdue ${trigger} promotes even when the other date is future`, async () => {
  await db.exec('set role authenticated');
  await query(`insert into cards (id,user_id,stream_id,title,status,due_at,remind_at) values
    ($1,$2,$3,'Separate triggers','priority_backlog',now() + make_interval(days => $4),now() + make_interval(days => $5))`,
  [original,user,stream,trigger === 'due_at' ? -2 : 2,trigger === 'remind_at' ? -2 : 2]);
  assert.equal((await promote())[0].count, 1);
});

test('ordinary undated backlogs stay put and promotion is restricted to the signed-in user', async () => {
  await db.exec('set role authenticated');
  await query(`insert into cards (id,user_id,stream_id,title,status)
    values ($1,$2,$3,'Undated task','backlog')`, [original,user,stream]);
  assert.equal((await promote())[0].count, 0);
  await query("update cards set due_at = now() - interval '2 days' where id = $1", [original]);
  await query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  assert.equal((await promote())[0].count, 0);
  await query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  assert.equal((await query('select status from cards where id = $1', [original]))[0].status, 'backlog');
  assert.equal((await promote())[0].count, 1);
});
