'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { ArrowLeft, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { watchAccount } from '@/lib/supabase/account-boundary';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';
import { UNCATEGORIZED_TITLE, type Area, type Stream } from '@/lib/types';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AccountMenu } from '@/components/AccountMenu';
import { AreaIndicator } from '@/components/AreaIndicator';
import { EditStreamModal } from '@/components/EditStreamModal';
import { AddStreamModal } from '@/components/AddStreamModal';
import { AreaFilter } from '@/components/AreaFilter';
import { useStreamOrder } from '@/components/useStreamOrder';
import { StreamOrdering, SortableStreamRow, StreamDragSurface, StreamOrderReset } from '@/components/StreamOrdering';
import { TooltipButton } from '@/components/TooltipButton';

const supabase = createClient();
const sections = [
  { state: 'in_progress', label: 'Active' },
  { state: 'complete', label: 'Complete' },
  { state: 'canceled', label: 'Canceled' },
] as const;

export default function StreamsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Area | 'all'>('all');
  const boundaryRef = useRef<ReturnType<typeof watchAccount> | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const boundary = boundaryRef.current;
    if (!boundary?.active) return;
    const sequence = ++loadSequence.current;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!boundary.active || sequence !== loadSequence.current) return;
      if (authError || !user) {
        window.location.replace('/login');
        return;
      }
      if (!boundary.acceptUser(user.id)) return;
      setUser(user);
      try {
        const preferences = JSON.parse(localStorage.getItem(`will-do-it:workspace:${user.id}`) || 'null');
        if (preferences && ['all', 'work', 'personal'].includes(preferences.area)) setActiveFilter(preferences.area);
      } catch {
        // Unavailable storage must not prevent loading streams.
      }
      const { data, error } = await supabase.from('streams').select('*').eq('user_id', user.id);
      if (!boundary.active || sequence !== loadSequence.current) return;
      if (error) throw error;
      // Older accounts may still contain the retired stream backlog state.
      setStreams((data || []).map((stream: Stream) => String(stream.state) === 'backlog'
        ? { ...stream, state: 'in_progress' } : stream));
    } catch (error) {
      if (boundary.active && sequence === loadSequence.current) setError(errorMessage(error, 'Could not load your streams'));
    } finally {
      if (boundary.active && sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cancelLoads = () => { ++loadSequence.current; };
    const boundary = watchAccount(supabase, signedOut => {
      ++loadSequence.current;
      setUser(null);
      setStreams([]);
      setEditingStream(null);
      setShowStreamModal(false);
      setError(null);
      toast.dismiss();
      window.location.replace(signedOut ? '/login' : '/streams');
    });
    boundaryRef.current = boundary;
    void Promise.resolve().then(load);
    return () => { boundary.dispose(); cancelLoads(); };
  }, [load]);

  const streamOrder = useStreamOrder(user?.id, streams);

  const changeArea = (area: Area | 'all') => {
    setActiveFilter(area);
    if (!user) return;
    try {
      const key = `will-do-it:workspace:${user.id}`;
      let preferences = {};
      try { preferences = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* Replace invalid saved preferences. */ }
      localStorage.setItem(key, JSON.stringify({ ...preferences, area }));
    } catch {
      // Filtering still works when storage is unavailable.
    }
  };

  if (!user && !error) return <main className="min-h-dvh flex items-center justify-center text-ink-soft">Loading your streams...</main>;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-chrome/80">
        <div className="px-4 sm:px-6 lg:px-8 min-h-14 py-1 flex flex-wrap items-center justify-between gap-2">
          <Link href="/" aria-label="Will Do It workspace" className="focus-ring rounded"><BrandLogo /></Link>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <AreaFilter value={activeFilter} onChange={changeArea} />
            <TooltipButton tooltip="Create a stream to organize your cards" onPress={() => setShowStreamModal(true)}
              isDisabled={!user || loading || !!error} className="btn btn-secondary px-3 py-1.5 text-sm">New Stream</TooltipButton>
            <ThemeToggle /><AccountMenu email={user?.email} />
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-ink-soft hover:text-ink focus-ring rounded mb-6">
          <ArrowLeft size={16} aria-hidden="true" /> Back to workspace
        </Link>
        <h1 className="text-2xl font-semibold">Streams</h1>
        <p className="mt-2 mb-8 text-sm text-ink-soft">All your streams, including those without cards. Select a stream to edit its details. Drag the empty space around a stream title to reorder. Keyboard: focus its reorder area and use Space, arrow keys, then Space.</p>
        <StreamOrderReset custom={streamOrder.custom} disabled={streamOrder.disabled} onReset={streamOrder.reset} />

        {error ? <div role="alert" className="rounded-xl border border-line bg-surface p-5">
          <p>{error}</p>
          <button type="button" className="btn btn-secondary min-h-11 mt-3" onClick={() => { setLoading(true); setError(null); void load(); }}>Try again</button>
        </div> : loading ? <p role="status" className="text-ink-soft">Loading your streams...</p> : (
          <div className="space-y-8">
            {sections.map(({ state, label }) => {
              const items = streamOrder.streams.filter(stream => stream.state === state &&
                (activeFilter === 'all' || stream.area === activeFilter || stream.area === 'neutral'));
              return <section key={state} aria-labelledby={`streams-${state}`}>
                <h2 id={`streams-${state}`} className="flex items-center gap-2 text-lg font-semibold mb-3">
                  {label} <span className="text-sm font-normal text-ink-soft">({items.length})</span>
                </h2>
                {items.length === 0 ? <p className="text-sm text-ink-soft">No {label.toLowerCase()} streams.</p> : (
                  <StreamOrdering streams={items} disabled={streamOrder.disabled} onMove={streamOrder.move}>
                  <ul className="rounded-xl border border-line bg-surface divide-y divide-line overflow-hidden">
                    {items.map(stream => {
                      return <SortableStreamRow as="li" key={stream.id} stream={stream}>
                        <StreamDragSurface stream={stream} className="p-4 min-h-14">
                          <span className="flex items-start gap-2 min-w-0">
                            {stream.area !== 'neutral' && <AreaIndicator area={stream.area} labelled />}
                            {stream.title === UNCATEGORIZED_TITLE
                              ? <span className="font-medium break-words">{stream.title}</span>
                              : <button type="button" aria-label={`Edit stream ${stream.title}`}
                                className="inline-flex items-start gap-2 min-w-0 font-medium text-left hover:underline focus-ring rounded"
                                onClick={event => { event.currentTarget.focus(); setEditingStream(stream); }}>
                                <span className="break-words min-w-0">{stream.title}</span>
                                <Pencil size={14} className="mt-1 shrink-0 text-ink-soft" aria-hidden="true" />
                              </button>}
                          </span>
                          {stream.notes && stream.title !== UNCATEGORIZED_TITLE && <span data-stream-text className="block mt-2 whitespace-pre-wrap break-words text-sm text-ink-soft">{stream.notes}</span>}
                        </StreamDragSurface>
                      </SortableStreamRow>;
                    })}
                  </ul>
                  </StreamOrdering>
                )}
              </section>;
            })}
          </div>
        )}
      </main>
      {showStreamModal && <AddStreamModal streams={streams} onClose={() => setShowStreamModal(false)}
        onStreamCreated={stream => {
          setStreams(current => [...current, stream]);
          if (activeFilter !== 'all' && stream.area !== activeFilter && stream.area !== 'neutral') changeArea('all');
        }} />}
      {editingStream && <EditStreamModal stream={editingStream} streams={streams} onClose={() => setEditingStream(null)}
        onStreamUpdated={updated => setStreams(current => current.map(stream => stream.id === updated.id ? updated : stream))}
        onStreamDeleted={id => setStreams(current => current.filter(stream => stream.id !== id))} />}
    </div>
  );
}
