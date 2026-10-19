import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';

let db;
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const migration = await readFile(new URL('../supabase/migrations/202610190001_push_reminders.sql', import.meta.url), 'utf8');
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const claim = () => query('select * from claim_push_reminders()');
before(async () => {
  db = new PGlite();
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create role authenticated; create role anon; create role service_role;
    grant usage on schema auth, public to authenticated;
    create table cards(id uuid primary key default gen_random_uuid(), user_id uuid, status text default 'backlog', due_at timestamptz, remind_at timestamptz);
    create function generate_recurring_instances(text) returns integer language sql as $$select 0$$;`);
  await db.exec(migration);
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec('reset role; truncate auth.users, cards cascade');
  await query('insert into auth.users values ($1), ($2)', [owner, other]);
  await query(`insert into push_subscriptions(user_id,endpoint,p256dh,auth,enabled_at) values
    ($1,'https://fcm.googleapis.com/fcm/send/example',repeat('a',87),repeat('a',22),now()-interval '2 hours')`, [owner]);
});
after(async () => db.close());
async function card(due, remind = null, status = 'backlog', user = owner) {
  return (await query('insert into cards(user_id,due_at,remind_at,status) values ($1,now()+$2::interval,case when $3::interval is null then null else now()+$3::interval end,$4) returning id', [user,due,remind,status]))[0].id;
}
test('respects exact times, explicit reminder precedence, account, and terminal state', async () => {
  await card('1 minute');
  await card('-1 minute', '1 minute');
  await card('-1 minute', null, 'complete');
  await card('-1 minute', null, 'canceled');
  await card('-1 minute', null, 'waiting', other);
  await card('-3 hours'); // Before device opt-in.
  await card('1 hour', '-1 minute');
  const due = await card('-1 minute', null, 'in_progress');
  assert.equal((await claim()).length, 2);
  assert.equal((await claim()).length, 0, 'parallel run must not claim leased rows');
  assert.equal((await query('select * from push_deliveries where card_id=$1',[due])).length,1);
});
test('retries failures, suppresses sent, completed, and rescheduled deliveries', async () => {
  const ids = await Promise.all([card('-1 minute'), card('-1 minute'), card('-1 minute'), card('-1 minute')]);
  assert.equal((await claim()).length,4);
  await db.exec("update push_deliveries set claimed_at=now()-interval '6 minutes'");
  await query('update push_deliveries set sent_at=now() where card_id=$1',[ids[0]]);
  await query("update cards set status='complete' where id=$1",[ids[1]]);
  await query("update cards set due_at=now()+interval '1 hour' where id=$1",[ids[2]]);
  assert.equal((await claim()).length,1);
  await db.exec("update push_deliveries set attempts=8, claimed_at=now()-interval '6 minutes'");
  assert.equal((await claim()).length,0);
});
test('subscription RLS isolates accounts and queue RPC is service-only', async () => {
  await query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await db.exec('set role authenticated');
  assert.equal((await query('select * from push_subscriptions')).length,0);
  assert.equal((await query('delete from push_subscriptions returning id')).length,0);
  await assert.rejects(claim(),/permission denied/);
  await assert.rejects(query('insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,$2,$3,$4)',[owner,'https://fcm.googleapis.com/another','a'.repeat(87),'a'.repeat(22)]),/row-level security/);
});
test('push endpoints cannot target arbitrary hosts', async () => {
  await assert.rejects(query('insert into push_subscriptions(user_id,endpoint,p256dh,auth) values ($1,$2,$3,$4)',[owner,'https://localhost/private','a'.repeat(87),'a'.repeat(22)]),/check constraint/);
});
test('service worker shows private notifications and opens only the workspace', async () => {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = { addEventListener: (name, fn) => { listeners[name] = fn; }, registration: { showNotification: async (...args) => shown.push(args) }, clients: { matchAll: async () => [], openWindow: async url => opened.push(url) }, location: { origin: 'https://example.com' } };
  vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL});
  let pending;
  listeners.push({ data: { json: () => ({ tag: 'reminder-1', title: 'secret', url: 'https://evil.example' }) }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(shown[0][0],'Will Do It');
  assert.equal(JSON.stringify(shown).includes('secret'),false);
  listeners.notificationclick({ notification: { close() {} }, waitUntil: p => { pending = p; } });
  await pending;
  assert.deepEqual(opened,['/']);
});

async function senderHarness({ failure = null } = {}) {
  let handler;
  const sent = [], updates = [], deleted = [];
  const row = { delivery_id: 'delivery', subscription_id: 'subscription', endpoint: 'https://fcm.googleapis.com/push', p256dh: 'key', auth: 'secret' };
  const db = {
    rpc: async () => ({ data: [row], error: null }),
    from: table => ({
      update: values => ({ eq: async (...args) => { updates.push({table,values,args}); return {error:null}; } }),
      delete: () => ({ eq: async (...args) => { deleted.push({table,args}); return {error:null}; } }),
    }),
  };
  const source = (await readFile(new URL('../supabase/functions/send-reminders/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  const js = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  vm.runInNewContext(js, {
    Deno: { env: { get: () => 'configured' }, serve: fn => { handler = fn; } },
    createClient: () => db,
    webpush: { setVapidDetails() {}, sendNotification: async (...args) => { if (failure) throw failure; sent.push(args); } },
    Response, Date,
  });
  return { handler, sent, updates, deleted };
}
test('push sender authenticates and records delivery only after provider acceptance', async () => {
  const sender = await senderHarness();
  assert.equal((await sender.handler(new Request('https://example.com',{method:'POST'}))).status,401);
  assert.equal(sender.sent.length,0);
  const response = await sender.handler(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer configured'}}));
  assert.deepEqual(await response.json(),{sent:1,failed:0});
  assert.equal(sender.sent.length,1);
  assert.equal(sender.updates[0].table,'push_deliveries');
  assert.equal(sender.sent[0][1],JSON.stringify({tag:'reminder-delivery'}));
});
test('expired endpoints are deleted while transient transport failures remain retryable', async () => {
  for (const statusCode of [410,503]) {
    const sender = await senderHarness({failure:{statusCode}});
    const response = await sender.handler(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer configured'}}));
    assert.deepEqual(await response.json(),{sent:0,failed:1});
    assert.equal(sender.updates.length,0);
    assert.equal(sender.deleted.length,statusCode === 410 ? 1 : 0);
  }
});
