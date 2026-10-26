// Deployed and checked with Supabase Deno, independently of Next.js.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (request: Request) => {
  const secret = Deno.env.get('PUSH_CRON_SECRET');
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  if (required.some(key => !Deno.env.get(key))) {
    console.error('push_configuration_missing');
    return new Response('Push not configured', { status: 503 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT'), Deno.env.get('VAPID_PUBLIC_KEY'), Deno.env.get('VAPID_PRIVATE_KEY'));
  const { data, error } = await db.rpc('claim_push_reminders');
  if (error) {
    // Do not log raw database errors: their details can contain private data.
    console.error('push_claim_failed');
    return new Response('Could not claim reminders', { status: 500 });
  }
  let sent = 0;
  let failed = 0;
  let expired = 0;
  let cleanupFailed = 0;
  const failures: Record<string, number> = {};
  function recordFailure(stage: string, error: unknown) {
    const status = error && typeof error === 'object' && 'statusCode' in error
      && typeof error.statusCode === 'number' && Number.isInteger(error.statusCode)
      && error.statusCode >= 100 && error.statusCode <= 599 ? error.statusCode : 'unknown';
    const category = `${stage}:${status}`;
    failures[category] = (failures[category] || 0) + 1;
  }
  // Ten requests at a time, bounded by the RPC's 100-delivery batch.
  for (let offset = 0; offset < data.length; offset += 10) {
    await Promise.all(data.slice(offset, offset + 10).map(async (row: { delivery_id: string; subscription_id: string; endpoint: string; p256dh: string; auth: string }) => {
      let stage = 'provider';
      try {
        // Fixed, generic copy avoids exposing card titles on a shared lock screen.
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify({ tag: `reminder-${row.delivery_id}` }),
          // Keep accepted pushes available while a phone is offline overnight.
          { TTL: 86400, urgency: 'high', timeout: 10000 });
        stage = 'record_acceptance';
        const result = await db.from('push_deliveries').update({ sent_at: new Date().toISOString() }).eq('id', row.delivery_id);
        if (result.error) throw result.error;
        sent++;
      } catch (error) {
        failed++;
        recordFailure(stage, error);
        if (stage === 'provider' && error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 404 || error.statusCode === 410)) {
          expired++;
          try {
            const result = await db.from('push_subscriptions').delete().eq('id', row.subscription_id);
            if (result.error) cleanupFailed++;
          } catch { cleanupFailed++; }
        }
        // Other failures remain leased for five minutes before retrying.
        // Never log subscription endpoints, keys, card data, or authorization.
      }
    }));
  }
  // One bounded summary per run, including failures that otherwise return HTTP 200.
  // Provider acceptance is not confirmation that the phone displayed a notification.
  console.info(JSON.stringify({ event: 'push_batch', claimed: data.length, sent, failed, expired, cleanupFailed, failures }));
  return Response.json({ sent, failed });
});
