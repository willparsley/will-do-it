import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import { driver, nodes, text } from './helpers/react-driver.mjs';

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
    create table recurrence_sources(id uuid primary key, user_id uuid, recurrence_timezone text);
    create table cards(id uuid primary key default gen_random_uuid(), user_id uuid, status text default 'backlog', due_at timestamptz, remind_at timestamptz, recurrence_source_id uuid);
    create function generate_recurring_instances(text) returns integer language sql as $$select 0$$;`);
  await db.exec(migration);
  await db.exec(migration);
  const preferences = await readFile(new URL('../supabase/migrations/202610190002_default_reminder_time.sql', import.meta.url), 'utf8');
  await db.exec(preferences);
  await db.exec(preferences);
});
beforeEach(async () => {
  await db.exec('reset role; truncate auth.users, cards cascade');
  await query('insert into auth.users values ($1), ($2)', [owner, other]);
  await query("insert into reminder_preferences(user_id,timezone) values ($1,'UTC')",[owner]);
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

async function notificationAt(instant, {time = '09:00', timezone = 'America/New_York', reminder = false} = {}) {
  await query('update reminder_preferences set default_reminder_time=$1, timezone=$2 where user_id=$3',[time,timezone,owner]);
  const [row] = await query(`insert into cards(user_id,due_at,remind_at) values ($1,$2,$3) returning *`,[owner,reminder ? null : instant,reminder ? instant : null]);
  return (await query('select card_push_time(c) as value from cards c where id=$1',[row.id]))[0].value.toISOString();
}
test('date-only due and reminder pushes use 9 AM, while explicit times stay exact', async () => {
  assert.equal(await notificationAt('2026-10-20T04:00:00Z'), '2026-10-20T13:00:00.000Z');
  assert.equal(await notificationAt('2026-10-20T04:00:00Z',{reminder:true}), '2026-10-20T13:00:00.000Z');
  assert.equal(await notificationAt('2026-10-20T04:00:00Z',{time:'10:30'}), '2026-10-20T14:30:00.000Z');
  assert.equal(await notificationAt('2026-10-20T06:17:12Z'), '2026-10-20T06:17:12.000Z');
});
test('default reminder time observes DST and fractional timezone offsets', async () => {
  assert.equal(await notificationAt('2026-03-08T05:00:00Z'), '2026-03-08T13:00:00.000Z');
  assert.equal(await notificationAt('2026-11-01T04:00:00Z'), '2026-11-01T14:00:00.000Z');
  assert.equal(await notificationAt('2026-10-19T18:15:00Z',{timezone:'Asia/Kathmandu'}), '2026-10-20T03:15:00.000Z');
});
test('profile changes reschedule pending pushes without replaying delivered reminders or changing card dates', async () => {
  // Choose an IANA fixed-offset zone where the current local hour is always 12.
  const hour = new Date().getUTCHours() - 12;
  const timezone = `Etc/GMT${hour >= 0 ? '+' : ''}${hour}`;
  await query("update reminder_preferences set timezone=$1,default_reminder_time='13:00' where user_id=$2",[timezone,owner]);
  const [row] = await query("insert into cards(user_id,due_at) values ($1,((now() at time zone $2)::date)::timestamp at time zone $2) returning id,due_at",[owner,timezone]);
  assert.equal((await claim()).length,0, 'no midnight push before chosen default');
  await query("update reminder_preferences set default_reminder_time='11:00' where user_id=$1",[owner]);
  assert.equal((await claim()).length,1);
  await db.exec("update push_deliveries set claimed_at=now()-interval '6 minutes'");
  await query("update reminder_preferences set default_reminder_time='13:00' where user_id=$1",[owner]);
  assert.equal((await claim()).length,0, 'pending retry moves to the new future default');
  await query("update reminder_preferences set default_reminder_time='11:30' where user_id=$1",[owner]);
  assert.equal((await claim()).length,1);
  await db.exec('update push_deliveries set sent_at=now()');
  await query("update reminder_preferences set default_reminder_time='12:00' where user_id=$1",[owner]);
  assert.equal((await claim()).length,0, 'changing default must not notify an already delivered card again');
  assert.deepEqual((await query('select due_at from cards where id=$1',[row.id]))[0].due_at,row.due_at);
});
test('reminder preferences validate timezone and time and isolate accounts', async () => {
  await assert.rejects(query("update reminder_preferences set timezone='Not/AZone'"),/Invalid reminder timezone/);
  await assert.rejects(query("update reminder_preferences set default_reminder_time='24:00'"),/check constraint/);
  await query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await db.exec('set role authenticated');
  assert.equal((await query('select * from reminder_preferences')).length,0);
  assert.equal((await query("update reminder_preferences set default_reminder_time='10:00' returning user_id")).length,0);
  await assert.rejects(query("insert into reminder_preferences(user_id,timezone) values ($1,'UTC')",[owner]),/row-level security/);
});

test('date-only recurring pushes use the source timezone and ordinary pushes wait for a known timezone', async () => {
  await db.exec('delete from reminder_preferences');
  const id = await card('-1 minute');
  assert.equal((await claim()).length,0);
  await query("insert into recurrence_sources(id,user_id,recurrence_timezone) values ($1,$2,'America/New_York')",[other,owner]);
  await query("update cards set due_at='2026-10-20T04:00:00Z',recurrence_source_id=$1 where id=$2",[other,id]);
  assert.equal((await query('select card_push_time(c) as value from cards c where id=$1',[id]))[0].value.toISOString(),'2026-10-20T13:00:00.000Z');
  await query('delete from recurrence_sources where id=$1',[other]);
});
test('profile loads the saved default, saves an edited time, and reports save errors', async () => {
  let failure = false;
  const saved = [];
  const component = driver('components/ReminderPreferences.tsx','ReminderPreferences',{userId:owner},{
    '@/lib/reminder-preferences': {ensureReminderPreferences: async () => {}},
    '@/lib/supabase/client': {createClient: () => ({from: () => ({
      select: () => ({eq: () => ({single: async () => ({data:{default_reminder_time:'10:15:00',timezone:'America/New_York'},error:null})})}),
      upsert: async value => {saved.push(value); return {error:failure ? new Error('offline') : null};},
    })})},
  });
  component.render();
  for(const effect of [...component.effects]) effect();
  await new Promise(resolve => setImmediate(resolve));
  let tree = component.render();
  assert.equal(nodes(tree,n=>n.type==='input')[0].props.value,'10:15');
  nodes(tree,n=>n.type==='input')[0].props.onChange({target:{value:'08:30'}});
  tree=component.render();
  nodes(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(saved[0],{user_id:owner,default_reminder_time:'08:30',timezone:'America/New_York'});
  assert.match(text(component.render()),/preferences saved/);
  failure=true;
  nodes(component.render(),n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
  await new Promise(resolve => setImmediate(resolve));
  assert.match(text(component.render()),/Could not save/);
});
