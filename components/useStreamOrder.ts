'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { type Stream } from '@/lib/types';
import { alphabeticalOrder, moveStreamOrder, orderedStreams, type StreamOrder } from '@/lib/stream-order';
import { errorMessage } from '@/lib/errors';

const supabase = createClient();
const validOrder = (value: unknown): value is StreamOrder => !!value && typeof value === 'object'
  && 'revision' in value && typeof value.revision === 'number'
  && 'ordered_ids' in value && (value.ordered_ids === null || (Array.isArray(value.ordered_ids) && value.ordered_ids.every(id => typeof id === 'string')));

export function useStreamOrder(userId: string | undefined, streams: Stream[]) {
  const [state, setState] = useState<{ userId?: string; order: StreamOrder; ready: boolean; saving: boolean }>({ order: alphabeticalOrder, ready: false, saving: false });
  const active = useRef<{ userId: string; alive: boolean; saving: boolean; sequence: number; refresh: () => Promise<void> } | null>(null);
  const order = state.userId === userId ? state.order : alphabeticalOrder;

  useEffect(() => {
    if (!userId) return;
    const session = { userId, alive: true, saving: false, sequence: 0, refresh: async () => {} };
    active.current = session;
    session.refresh = async () => {
      if (!session.alive || session.saving) return;
      const sequence = ++session.sequence;
      const { data, error } = await supabase.rpc('get_stream_order');
      if (!session.alive || session.saving || sequence !== session.sequence) return;
      if (error) {
        toast.error(errorMessage(error, 'Could not load stream order'));
        return;
      }
      const next = validOrder(data) ? data : alphabeticalOrder;
      setState(current => current.userId === userId && current.order.revision > next.revision ? current
        : { userId, order: next, ready: true, saving: false });
    };
    void session.refresh();
    const focus = () => { if (document.visibilityState === 'visible') void session.refresh(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    const channel = supabase.channel(`stream-order:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stream_orders', filter: `user_id=eq.${userId}` }, () => { void session.refresh(); })
      .subscribe(status => { if (status === 'SUBSCRIBED') void session.refresh(); });
    return () => {
      session.alive = false;
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const save = async (moved?: string, target?: string, after = false) => {
    const session = active.current;
    if (!session?.alive || session.userId !== userId || session.saving || !state.ready || state.userId !== userId) return;
    session.saving = true;
    ++session.sequence;
    const previous = order;
    setState({ userId, order: { ...order, ordered_ids: moved && target ? moveStreamOrder(streams, order.ordered_ids, moved, target, after) : null }, ready: true, saving: true });
    try {
      const { data, error } = await supabase.rpc('move_stream', {
        p_stream_id: moved || null, p_target_id: target || null, p_after: after, p_reset: !moved,
      });
      if (error) throw error;
      if (!validOrder(data)) throw new Error('Invalid stream order response');
      if (session.alive) setState({ userId, order: data, ready: true, saving: false });
    } catch (error) {
      if (session.alive) {
        setState({ userId, order: previous, ready: true, saving: false });
        toast.error(errorMessage(error, 'Could not save stream order'));
      }
    } finally {
      session.saving = false;
      // Reconcile a concurrent move whose Realtime notification arrived during save.
      if (session.alive) void session.refresh();
    }
  };
  return {
    streams: orderedStreams(streams, order.ordered_ids),
    custom: order.ordered_ids !== null,
    disabled: state.userId !== userId || !state.ready || state.saving,
    move: (id: string, target: string, after: boolean) => save(id, target, after),
    reset: () => save(),
  };
}
