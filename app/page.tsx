'use client';

import React, { useEffect, useState } from 'react';
import { 
  DndContext, 
  closestCenter, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, ACTIVE_STATUSES, BACKLOG_STATUSES, STATUS_LABELS, Area } from '@/lib/types';
import { AreaFilter } from '@/components/AreaFilter';
import { AddCardModal } from '@/components/AddCardModal';
import { Card as CardComponent } from '@/components/Card';
import { DroppableCell } from '@/components/DroppableCell';
import { EditCardModal } from '@/components/EditCardModal';
import { Plus, LogOut } from 'lucide-react';
import { toast } from 'sonner';

const supabase = createClient();

export default function WillDoIt() {
  const [user, setUser] = useState<any>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activeFilter, setActiveFilter] = useState<Area | 'all'>('all');
  const [view, setView] = useState<'activated' | 'backlog' | 'archive' | 'all'>('activated');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  const sensors = useSensors(useSensor(PointerSensor));

  // Auth + Data loading
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        window.location.replace('/login');
        return;
      }
      
      setUser(user);
      await loadData(user.id);
    };
    init();
  }, []);

  const loadData = async (userId: string) => {
    setLoading(true);

    const { data: streamsData } = await supabase
      .from('streams')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true });

    let loadedStreams = streamsData || [];

    // Auto-create Uncategorized if missing
    const hasUncategorized = loadedStreams.some((s: any) => s.title === 'Uncategorized');
    if (!hasUncategorized) {
      const { data: newUnc } = await supabase
        .from('streams')
        .insert({
          user_id: userId,
          title: 'Uncategorized',
          state: 'in_progress',
          area: 'neutral',
          position: 999,
        })
        .select()
        .single();

      if (newUnc) loadedStreams.push(newUnc);
    }

    setStreams(loadedStreams);

    const { data: cardsData } = await supabase
      .from('cards')
      .select('*')
      .eq('user_id', userId);

    let loadedCards = cardsData || [];

    // Basic auto-promotion on load (time-sensitive + recurring)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const cardsToUpdate: any[] = [];

    loadedCards = loadedCards.map((card: any) => {
      let newStatus = card.status;

      // Time-sensitive auto-promotion
      const due = card.due_at ? new Date(card.due_at) : null;
      const remind = card.remind_at ? new Date(card.remind_at) : null;

      const isToday = (date: Date | null) => 
        date && date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate();

      if ((isToday(due) || isToday(remind)) && 
          (card.status === 'prioritized_backlog' || card.status === 'regular_backlog')) {
        newStatus = 'waiting';
      }

      if (newStatus !== card.status) {
        cardsToUpdate.push({ id: card.id, status: newStatus });
        return { ...card, status: newStatus };
      }
      return card;
    });

    // Persist auto-promotions
    if (cardsToUpdate.length > 0) {
      for (const update of cardsToUpdate) {
        await supabase.from('cards').update({ status: update.status }).eq('id', update.id);
      }
      toast.info(`${cardsToUpdate.length} item(s) auto-promoted`);
    }

    setCards(loadedCards);
    setLoading(false);
  };

  const filteredStreams = streams
    .filter((stream) => {
      if (activeFilter !== 'all' && stream.area !== activeFilter && stream.area !== 'neutral') {
        return false;
      }
      return getCardsForStream(stream.id).length > 0;
    })
    .sort((a, b) => a.position - b.position);

  function getCardsForStream(streamId: string): Card[] {
    let relevantStatuses: string[];
    if (view === 'activated') relevantStatuses = ACTIVE_STATUSES;
    else if (view === 'backlog') relevantStatuses = BACKLOG_STATUSES;
    else relevantStatuses = ['complete', 'canceled'];

    return cards
      .filter((c) => c.stream_id === streamId && relevantStatuses.includes(c.status))
      .sort((a, b) => a.position - b.position);
  }

  function getColumns() {
    if (view === 'activated') return ACTIVE_STATUSES;
    if (view === 'backlog') return [...BACKLOG_STATUSES, 'research' as const];
    if (view === 'all') {
      return [
        'regular_backlog',
        'prioritized_backlog',
        'research',
        'waiting',
        'in_progress',
        'review',
        'complete',
        'canceled',
      ] as const;
    }
    return ['complete', 'canceled'] as const;
  }

  const columns = getColumns();

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !user) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeCard = cards.find((c) => c.id === activeId);
    if (!activeCard) return;

    const [targetStreamId, targetStatus] = overId.includes('-')
      ? overId.split('-')
      : [activeCard.stream_id, overId];

    if (!targetStatus) return;

    const oldStream = activeCard.stream_id;

    // Optimistic
    const newCards = cards.map((c) =>
      c.id === activeId ? { ...c, stream_id: targetStreamId, status: targetStatus as any } : c
    );
    setCards(newCards);

    try {
      await supabase
        .from('cards')
        .update({ stream_id: targetStreamId, status: targetStatus })
        .eq('id', activeId);

      // Update recurrence source if this card is recurring
      if (activeCard.is_recurring && activeCard.recurrence_source_id) {
        await supabase
          .from('recurrence_sources')
          .update({ stream_id: targetStreamId })
          .eq('id', activeCard.recurrence_source_id);
      }

      toast.success('Moved');
    } catch (err) {
      console.error(err);
      toast.error('Move failed');
      setCards(cards); // revert
    }
  };

  const handleCardCreated = (newCard: Card) => {
    setCards((prev) => [...prev, newCard]);
  };

  const handleCardUpdated = (updatedCard: Card) => {
    setCards((prev) =>
      prev.map((c) => (c.id === updatedCard.id ? updatedCard : c))
    );
  };

  const handleCardDeleted = (cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div>Loading your workspace...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="font-semibold text-xl tracking-tight">Will Do It</div>
          </div>

          <div className="flex items-center gap-4">
            <AreaFilter value={activeFilter} onChange={setActiveFilter} />

            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-sm">
              {(['activated', 'backlog', 'all', 'archive'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-1.5 transition-colors ${
                    view === v
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-950'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {v === 'activated' ? 'Active' : v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-zinc-900 hover:bg-black text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> Quick Add
            </button>

            <button onClick={handleSignOut} className="p-2 text-zinc-500 hover:text-zinc-700">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">
            {view === 'activated' && 'Active Work'}
            {view === 'backlog' && 'Backlog'}
            {view === 'all' && 'All Statuses'}
            {view === 'archive' && 'Archive'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Drag cards between streams and columns.</p>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="space-y-4">
            <div 
              className="grid gap-4" 
              style={{ 
                gridTemplateColumns: view === 'all' 
                  ? `180px repeat(${columns.length}, 1fr)` 
                  : `260px repeat(${columns.length}, 1fr)` 
              }}
            >
              <div className="font-medium text-sm px-3 text-zinc-500">Stream</div>
              {columns.map((status) => (
                <div key={status} className="px-3 py-2 text-xs font-medium tracking-wider uppercase text-zinc-500 dark:text-zinc-400">
                  {STATUS_LABELS[status as keyof typeof STATUS_LABELS] || status}
                </div>
              ))}
            </div>

            {filteredStreams.length > 0 ? (
              filteredStreams.map((stream) => {
                const streamCards = getCardsForStream(stream.id);

                return (
                  <div
                    key={stream.id}
                    className={`stream-row rounded-xl p-4 ${stream.title === 'Uncategorized' ? 'uncategorized' : ''}`}
                  >
                    <div 
                      className="grid gap-4" 
                      style={{ 
                        gridTemplateColumns: view === 'all' 
                          ? `180px repeat(${columns.length}, 1fr)` 
                          : `240px repeat(${columns.length}, 1fr)` 
                      }}
                    >
                      <div className="pr-4">
                        <div className="font-medium flex items-center gap-2">
                          {stream.title}
                          {stream.area !== 'neutral' && (
                            <span className="text-[10px] px-1.5 py-px rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                              {stream.area}
                            </span>
                          )}
                        </div>
                      </div>

                      {columns.map((status) => {
                        const cellCards = streamCards.filter((c) => c.status === status);
                        const cellId = `${stream.id}-${status}`;

                        return (
                          <DroppableCell key={status} id={cellId}>
                            <div className="space-y-2">
                              {cellCards.map((card) => (
                                <CardComponent 
                                  key={card.id} 
                                  card={card} 
                                  onClick={() => setEditingCard(card)} 
                                />
                              ))}
                              {cellCards.length === 0 && (
                                <div className="text-[10px] text-zinc-400 h-8 flex items-center justify-center">Drop here</div>
                              )}
                            </div>
                          </DroppableCell>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-zinc-500">
                No streams with cards in this view.
              </div>
            )}
          </div>
        </DndContext>

        {showAddModal && (
          <AddCardModal
            streams={streams}
            onClose={() => setShowAddModal(false)}
            onCardCreated={handleCardCreated}
          />
        )}

        {editingCard && (
          <EditCardModal
            card={editingCard}
            streams={streams}
            onClose={() => setEditingCard(null)}
            onCardUpdated={handleCardUpdated}
            onCardDeleted={handleCardDeleted}
          />
        )}
      </div>
    </div>
  );
}
