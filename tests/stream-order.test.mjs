import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { orderedStreams, moveStreamOrder } = loadTypeScript('lib/stream-order.ts');
const streams = ['zebra', 'Alpha', 'Uncategorized', 'Beta', 'Empty'].map((title, i) => ({ id: String(i), title }));
const titles = rows => rows.map(s => s.title);
test('default, custom, new and deleted streams, rename, and pinned Uncategorized', () => {
  assert.deepEqual(titles(orderedStreams(streams, null)), ['Alpha', 'Beta', 'Empty', 'zebra', 'Uncategorized']);
  const ids = moveStreamOrder(streams, null, '0', '1', false);
  assert.deepEqual(ids, ['0', '1', '3', '4']);
  assert.deepEqual(titles(orderedStreams(streams, ['0', 'missing', '1', '2'])), ['zebra', 'Alpha', 'Beta', 'Empty', 'Uncategorized']);
  assert.deepEqual(titles(orderedStreams(streams.map(s => s.id === '0' ? { ...s, title: 'Renamed' } : s), ids)), ['Renamed', 'Alpha', 'Beta', 'Empty', 'Uncategorized']);
  // A filtered view moves its chosen row relative to the target while leaving
  // hidden rows in the same relative order.
  assert.deepEqual(moveStreamOrder(streams, ids, '0', '3', true), ['1', '3', '0', '4']);
});

test('database ordering is atomic, account isolated, and relative to the latest order', async () => {
  const db = new PGlite();
  const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const account = uid(1), other = uid(2);
  const [alpha, beta, zebra, unc, foreign, empty] = [3, 4, 5, 6, 7, 8].map(uid);
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create role authenticated; create role anon;
      grant usage on schema public,auth to authenticated,anon;
      alter default privileges in schema public grant select,insert,update,delete on tables to authenticated,anon;`);
    await db.exec((await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')).replace('create extension if not exists "uuid-ossp";', '').replaceAll('uuid_generate_v4()', 'gen_random_uuid()'));
    await db.exec(await readFile(new URL('../supabase/migrations/202610210001_stream_order.sql', import.meta.url), 'utf8'));
    await q('insert into auth.users values($1),($2)', [account, other]);
    for (const [id, user, title] of [[alpha, account, 'Alpha'], [beta, account, 'Beta'], [zebra, account, 'zebra'], [unc, account, 'Uncategorized'], [foreign, other, 'Foreign']]) {
      await q("insert into streams(id,user_id,title,state,area) values($1,$2,$3,'in_progress','neutral')", [id, user, title]);
    }
    await db.exec('set role authenticated');
    await q("select set_config('request.jwt.claim.sub',$1,false)", [account]);
    const read = async () => (await q('select get_stream_order() as result'))[0].result;
    const move = async (id, target, after = false) => (await q('select move_stream($1,$2,$3) as result', [id, target, after]))[0].result;
    assert.equal(await read(), null);
    assert.deepEqual(await move(zebra, alpha), { ordered_ids: [zebra, alpha, beta], revision: 1 });
    // Device B moves Beta using a stale view: device A's zebra placement survives.
    assert.deepEqual(await move(beta, alpha), { ordered_ids: [zebra, beta, alpha], revision: 2 });
    // Invalid and cross-account moves roll back without changing the revision.
    for (const [id, target] of [[unc, alpha], [alpha, unc], [foreign, alpha], [alpha, foreign], [uid(99), alpha], [alpha, alpha]]) {
      await assert.rejects(move(id, target));
    }
    assert.equal((await read()).revision, 2);
    await assert.rejects(q('update stream_orders set ordered_ids = null'));
    await assert.rejects(q('insert into stream_orders(user_id) values($1)', [other]));
    await q("insert into streams(id,user_id,title,state,area) values($1,$2,'Empty','in_progress','neutral')", [empty, account]);
    // New streams are included on the next move; rename does not change rank.
    await q("update streams set title='A renamed zebra' where id=$1", [zebra]);
    assert.deepEqual((await move(alpha, empty, true)).ordered_ids, [zebra, beta, empty, alpha]);
    await q('delete from streams where id=$1', [beta]);
    assert.deepEqual((await move(alpha, zebra)).ordered_ids, [alpha, zebra, empty]);
    await q("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal(await read(), null);
    assert.deepEqual(await q('select * from stream_orders'), []);
    await assert.rejects(move(foreign, alpha));
    await q("select set_config('request.jwt.claim.sub',$1,false)", [account]);
    const reset = (await q('select move_stream(p_reset => true) as result'))[0].result;
    assert.deepEqual(reset, { ordered_ids: null, revision: 5 });
    await db.exec('reset role; set role anon');
    await q("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(q('select get_stream_order()'));
    await assert.rejects(q('select move_stream(p_reset => true)'));
  } finally { await db.close(); }
});
