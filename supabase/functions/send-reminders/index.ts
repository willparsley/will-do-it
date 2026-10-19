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
  if (required.some(key => !Deno.env.get(key))) return new Response('Push not configured', { status: 503 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT'), Deno.env.get('VAPID_PUBLIC_KEY'), Deno.env.get('VAPID_PRIVATE_KEY'));
  const { data, error } = await db.rpc('claim_push_reminders');
  if (error) return new Response('Could not claim reminders', { status: 500 });
  let sent = 0;
  let failed = 0;
  // Ten requests at a time, bounded by the RPC's 100-delivery batch.
  for (let offset = 0; offset < data.length; offset += 10) {
    await Promise.all(data.slice(offset, offset + 10).map(async (row: { delivery_id: string; subscription_id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        // Fixed, generic copy avoids exposing card titles on a shared lock screen.
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify({ tag: `reminder-${row.delivery_id}` }),
          { TTL: 3600, urgency: 'high', timeout: 10000 });
        const result = await db.from('push_deliveries').update({ sent_at: new Date().toISOString() }).eq('id', row.delivery_id);
        if (result.error) throw result.error;
        sent++;
      } catch (error) {
        failed++;
        if (error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 404 || error.statusCode === 410)) {
          await db.from('push_subscriptions').delete().eq('id', row.subscription_id);
        }
        // Other failures remain leased for five minutes before retrying.
        // Never log subscription endpoints, keys, card data, or authorization.
      }
    }));
  }
  return Response.json({ sent, failed });
});
