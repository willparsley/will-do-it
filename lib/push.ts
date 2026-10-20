import { createClient } from '@/lib/supabase/client';

export async function disablePush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  const { error } = await createClient().from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  // Revoke the browser endpoint even if the network is unavailable during logout.
  const removed = await subscription.unsubscribe();
  if (!removed) throw new Error('Could not disable browser notifications. Please try again.');
  if (error) throw new Error('Notifications disabled here, but the server could not be updated.');
}
