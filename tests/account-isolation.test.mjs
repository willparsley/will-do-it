import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
test('database isolation blocks foreign and anonymous access, including direct stream links', async () => {
const db = new PGlite();
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const a=uid(1), b=uid(2), sa=uid(3), sb=uid(4), ca=uid(5), cb=uid(6), ra=uid(7), rb=uid(8), target=uid(9);
const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
try {
await db.exec(`create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create role authenticated; create role service_role; create role anon;
 grant usage on schema public,auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;
 alter default privileges in schema public grant select,insert,update,delete on tables to authenticated,anon;`);
await db.exec((await readFile(root+'/supabase/schema.sql','utf8')).replace('create extension if not exists "uuid-ossp";','').replaceAll('uuid_generate_v4()','gen_random_uuid()'));
for(const f of (await readdir(root+'/supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(root+'/supabase/migrations/'+f,'utf8'));
await q('insert into auth.users values($1),($2)',[a,b]);
for (const [id,user,title] of [[sa,a,'A stream'],[sb,b,'B stream'],[target,b,'B destination']]) await q("insert into streams(id,user_id,title,state,area) values($1,$2,$3,'in_progress','neutral')",[id,user,title]);
for (const [id,user,stream] of [[ca,a,sa],[cb,b,sb]]) await q("insert into cards(id,user_id,stream_id,title,status) values($1,$2,$3,'Private card','research')",[id,user,stream]);
for (const [id,user,stream] of [[ra,a,sa],[rb,b,sb]]) await q("insert into recurrence_sources(id,user_id,stream_id,base_title,frequency,stopped_at) values($1,$2,$3,'Private recurrence','daily',now())",[id,user,stream]);
await db.exec('set role authenticated'); await q("select set_config('request.jwt.claim.sub',$1,false)",[a]);
for(const [table,id] of [['streams',sb],['cards',cb],['recurrence_sources',rb]]) {
 assert.equal((await q(`select * from ${table} where id=$1`,[id])).length,0);
 assert.equal((await q(`update ${table} set user_id=$1 where id=$2 returning id`,[a,id])).length,0);
 assert.equal((await q(`delete from ${table} where id=$1 returning id`,[id])).length,0);
}
for(const [sql,args] of [
 ["insert into streams(user_id,title,state,area) values($1,'Forged','in_progress','neutral')",[b]],
 ["insert into cards(user_id,stream_id,title,status) values($1,$2,'Forged','research')",[b,sa]],
 ["insert into recurrence_sources(user_id,stream_id,base_title) values($1,$2,'Forged')",[b,sa]],
 ['update streams set user_id=$1 where id=$2',[b,sa]],
 ['update cards set user_id=$1 where id=$2',[b,ca]],
 ['update recurrence_sources set user_id=$1 where id=$2',[b,ra]],
]) {await assert.rejects(q(sql,args));}
for(const [sql,args] of [
 ["select save_card($1,'{\"title\":\"stolen\"}'::jsonb,'research')",[cb]],
 ["select save_card_with_undo($1,'{\"title\":\"stolen\"}'::jsonb,'research','UTC')",[cb]],
 ["select save_stream($1,'stolen','neutral','','in_progress','[]')",[sb]],
 ['select delete_stream_rehoming($1,$2)',[sb,sa]],
 ["select save_recurrence($1,now(),'{\"base_title\":\"stolen\"}','UTC')",[rb]],
 ["select save_card($1,jsonb_build_object('stream_id',$2::text),'research')",[ca,sb]],
]) {await assert.rejects(q(sql,args));}
assert.deepEqual(await q("select recurrences_for_stream($1,'UTC')",[sb]),[]);
await assert.rejects(q('select * from card_action_undos'));
// Try bypassing the app RPC with direct SQL, as a Data API client can.
await assert.rejects(q("insert into cards(user_id,stream_id,title,status) values($1,$2,'Foreign stream attachment','research')",[a,sb]), /cards_stream_owner_fkey/);
await assert.rejects(q('update cards set stream_id=$1 where id=$2',[target,ca]), /cards_stream_owner_fkey/);
await assert.rejects(q("insert into recurrence_sources(user_id,stream_id,base_title,stopped_at) values($1,$2,'Foreign stream reference',now())",[a,sb]), /recurrence_sources_stream_owner_fkey/);
await assert.rejects(q('update recurrence_sources set stream_id=$1 where id=$2',[sb,ra]));
// Matching-owner inserts and moves still work, including stream deletion/rehome.
await q("insert into cards(user_id,stream_id,title,status) values($1,$2,'Allowed','research')",[a,sa]);
await q("select set_config('request.jwt.claim.sub',$1,false)",[b]);
await q('select delete_stream_rehoming($1,$2)',[sb,target]);
assert.equal((await q('select * from streams where id=$1',[sb])).length,0);
assert.equal((await q('select stream_id from cards where id=$1',[cb]))[0].stream_id,target);
assert.equal((await q('select stream_id from recurrence_sources where id=$1',[rb]))[0].stream_id,target);
await db.exec('reset role; set role anon');await q("select set_config('request.jwt.claim.sub','',false)");
for(const table of ['streams','cards','recurrence_sources']) {
 assert.deepEqual(await q(`select * from ${table}`),[]);
 assert.equal((await q(`update ${table} set user_id=$1 returning id`,[b])).length,0);
 assert.equal((await q(`delete from ${table} returning id`)).length,0);
}
for(const [sql,args] of [
 ["insert into streams(user_id,title,state,area) values($1,'Anon','in_progress','neutral')",[b]],
 ["insert into cards(user_id,stream_id,title,status) values($1,$2,'Anon','research')",[b,sb]],
 ["insert into recurrence_sources(user_id,stream_id,base_title) values($1,$2,'Anon')",[b,sb]],
 ["select save_card($1,'{}','research')",[cb]],
 ["select save_card_with_undo($1,'{}','research','UTC')",[cb]],
 ["select save_stream($1,'Anon','neutral','','in_progress','[]')",[sb]],
 ['select delete_stream_rehoming($1,$2)',[sb,target]],
 ["select generate_recurring_instances('UTC')",[]],
 ["select promote_due_cards('UTC')",[]],
 ["select undo_card_action($1)",[uid(10)]],
 ["select save_recurrence($1,now(),'{}','UTC')",[rb]],
 ["select recurrences_for_stream($1,'UTC')",[sb]],
]) {await assert.rejects(q(sql,args));}
assert.deepEqual(await q('select * from card_action_undos'),[]);
// Legacy ownership violations stop the migration without rewriting history.
await db.exec('reset role; alter table cards drop constraint cards_stream_owner_fkey');
await q('update cards set stream_id=$1 where id=$2',[target,ca]);
const migration=await readFile(root+'/supabase/migrations/202610180002_stream_ownership.sql','utf8');
await assert.rejects(db.exec(migration),/Stream ownership mismatch/);
await db.exec('rollback');
assert.equal((await q('select stream_id from cards where id=$1',[ca]))[0].stream_id,target);
await q('update cards set stream_id=$1 where id=$2',[sa,ca]);
await db.exec(migration);
await db.exec(migration);
} finally {await db.close();}
});
