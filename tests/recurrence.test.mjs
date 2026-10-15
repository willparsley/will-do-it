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

test('promotion catches up overdue recurring backlogs without advancing other active statuses or ordinary overdue cards', async () => {
  await fixture({ active: true, daysAgo: 2 });
  await query("update cards set status = 'backlog' where id = $1", [original]);
  await query("insert into cards (user_id, stream_id, title, status, due_at) values ($1,$2,'Ordinary overdue','backlog',now() - interval '2 days')", [user, stream]);
  assert.equal((await promote())[0].count, 1);
  assert.equal((await query('select status from cards where id = $1', [original]))[0].status, 'waiting');
  await query("update cards set status = 'in_progress' where id = $1", [original]);
  assert.equal((await promote())[0].count, 0);
  assert.equal((await query("select status from cards where title = 'Ordinary overdue'"))[0].status, 'backlog');
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
