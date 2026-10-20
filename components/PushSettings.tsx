'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ensureReminderPreferences } from '@/lib/reminder-preferences';
import { disablePush } from '@/lib/push';

export function PushSettings({ userId }: { userId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [supported, setSupported] = useState(false);
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let active = true;
    const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setSupported(supported);
      if (!supported || !key) { setBusy(false); return; }
      try {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const { data, error } = await createClient().from('push_subscriptions').select('id').eq('endpoint', subscription.endpoint).eq('user_id', userId).maybeSingle();
          if (error) throw error;
          if (active) setEnabled(Boolean(data));
        }
      } catch { if (active) setMessage('Could not check notification settings.'); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [key, userId]);

  async function toggle() {
    setBusy(true);
    setMessage('');
    try {
      if (enabled) { await disablePush(); setEnabled(false); return; }
      // Permission must be requested directly from this user gesture (iOS).
      if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser or device settings to continue.');
      await ensureReminderPreferences(userId);
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (!registration.active) {
        await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Notification setup is still updating. Please try again.')), 15000))]);
      }
      // A browser endpoint belongs to one account. Replace any old subscription.
      const previous = await registration.pushManager.getSubscription();
      if (previous && !await previous.unsubscribe()) throw new Error('Could not replace the previous notification subscription.');
      const padded = key!.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(padded + '='.repeat((4 - padded.length % 4) % 4)), c => c.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      const json = subscription.toJSON();
      const { error } = await createClient().from('push_subscriptions').insert({ user_id: userId, endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth });
      if (error) { await subscription.unsubscribe(); throw new Error('Could not save notification settings. Please try again.'); }
      setEnabled(true);
      setMessage('Notifications enabled on this device.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update notifications.'); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="push-heading" className="rounded-xl border border-line bg-surface p-6 mt-6">
    <h2 id="push-heading" className="font-semibold mb-3">Push notifications</h2>
    <p className="text-sm text-ink-soft mb-3">Receive a notification at the reminder time, or the due time if no reminder is set. Dates without a time use your default reminder time (9:00 AM initially), set in Reminder preferences. Delivery normally takes about a minute and can be delayed by your device or connection.</p>
    <p className="text-sm text-ink-soft mb-3">On iPhone or iPad, install to your Home Screen and open the installed app first. Notifications show a private, generic message and open your workspace.</p>
    {!supported ? <p className="text-sm">Push is unavailable in this browser. Try the installed app or a supported browser.</p>
      : !key ? <p className="text-sm">Push notifications have not been configured for this app yet.</p>
      : <button className="btn btn-primary min-h-11" disabled={busy} onClick={() => void toggle()}>{busy ? 'Checking…' : enabled ? 'Disable on this device' : 'Enable on this device'}</button>}
    <p role="status" className="text-sm mt-3">{message}</p>
  </section>;
}
