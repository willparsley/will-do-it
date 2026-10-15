'use client';

import React, { useEffect, useState } from 'react';
import { 
  DndContext, 
  closestCenter, 
  MouseSensor, 
  TouchSensor, 
  useSensor, 
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragCancelEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, ACTIVE_STATUSES, BACKLOG_STATUSES, Area, streamsForDisplay, nextStatus, STATUS_LABELS } from '@/lib/types';
import { AreaFilter } from '@/components/AreaFilter';
import { AddCardModal } from '@/components/AddCardModal';
import { Card as CardComponent } from '@/components/Card';
import { DroppableCell } from '@/components/DroppableCell';
import { StatusHeader } from '@/components/StatusHeader';
import { EditCardModal } from '@/components/EditCardModal';
import { AddStreamModal } from '@/components/AddStreamModal';
import { EditStreamModal } from '@/components/EditStreamModal';
import { Plus, LogOut, Pencil } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from 'sonner';

const supabase = createClient();

const VIEWS = [
  { id: 'activated', label: 'Active' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'all', label: 'All' },
  { id: 'archive', label: 'Archive' },
] as const;

export default function WillDoIt() {
  const [user, setUser] = useState<any>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [activeFilter, setActiveFilter] = useState<Area | 'all'>('all');
  const [view, setView] = useState<'activated' | 'backlog' | 'archive' | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);
  const [activeDragCard, setActiveDragCard] = useState<Card | null>(null);

  const sensors = useSensors(
    // Mouse: drag once the pointer moves a little, so plain clicks still work.
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Touch: press and hold briefly, so the page can still scroll.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

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

    // Dedupe Uncategorized (safety if multiple rows exist in DB)
    const uncIds = new Set();
    loadedStreams = loadedStreams.filter((s: any) => {
      if (s.title === 'Uncategorized') {
        if (uncIds.size > 0) return false;
        uncIds.add(s.id);
      }
      return true;
    });

    // Streams no longer use the 'backlog' state — migrate any legacy rows to active.
    const legacyStateIds = loadedStreams
      .filter((s: any) => s.state === 'backlog')
      .map((s: any) => s.id);
    if (legacyStateIds.length > 0) {
      await supabase.from('streams').update({ state: 'in_progress' }).in('id', legacyStateIds);
      loadedStreams = loadedStreams.map((s: any) =>
        s.state === 'backlog' ? { ...s, state: 'in_progress' } : s
      );
    }

    setStreams(loadedStreams);

    // Database locks and occurrence keys make refreshes safe across tabs/devices.
    const { error: recurrenceError } = await supabase.rpc('generate_recurring_instances', {
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (recurrenceError) {
      console.error(recurrenceError);
      toast.error('Could not refresh recurring tasks');
    }

    const { error: promotionError } = await supabase.rpc('promote_due_cards', {
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (promotionError) {
      console.error(promotionError);
      toast.error('Could not refresh reminders');
    }

    const { data: cardsData, error: cardsError } = await supabase
      .from('cards')
      .select('*')
      .eq('user_id', userId);
    if (cardsError) {
      console.error(cardsError);
      toast.error('Could not load cards');
    } else {
      setCards(cardsData || []);
    }
    setLoading(false);
  };

  const filteredStreams = streamsForDisplay(
    streams.filter((stream) => {
      if (activeFilter !== 'all' && stream.area !== activeFilter && stream.area !== 'neutral') {
        return false;
      }
      return getCardsForStream(stream.id).length > 0;
    })
  );

  function getCardsForStream(streamId: string): Card[] {
    let relevantStatuses: string[];
    if (view === 'activated') relevantStatuses = ACTIVE_STATUSES;
    else if (view === 'backlog') relevantStatuses = BACKLOG_STATUSES;
    else if (view === 'all') {
      relevantStatuses = ['backlog', 'priority_backlog', 'research', 'waiting', 'in_progress', 'review', 'complete', 'canceled'];
    } else {
      relevantStatuses = ['complete', 'canceled'];
    }

    return cards
      .filter((c) => c.stream_id === streamId && relevantStatuses.includes(c.status))
      .sort((a, b) => a.position - b.position);
  }

  function getColumns() {
    if (view === 'activated') return ACTIVE_STATUSES;
    if (view === 'backlog') return [...BACKLOG_STATUSES, 'research' as const];
    if (view === 'all') {
      return [
        'backlog',
        'priority_backlog',
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

  // Layout sizing.
  const streamColWidth = view === 'all' ? 180 : 220;

  // Max status-column width. Wide enough that the longest status title
  // ("Priority Backlog") stays on one line, but not so wide that cards get
  // stretched out on high-resolution screens.
  const COL_MAX = 240;
  const GRID_GAP = 12; // must match the `gap-3` class used by the grids

  // Shared by the header and every row so their columns always line up.
  // minmax(0, COL_MAX) lets columns shrink to fit but never exceed COL_MAX.
  const gridColumns = `${streamColWidth}px repeat(${columns.length}, minmax(0, ${COL_MAX}px))`;

  // Cap the whole matrix so row panels end where the columns end instead of
  // trailing off into empty space. The +34 accounts for a row's p-4 padding
  // (32px) and its 1px top/bottom borders.
  const matrixMaxWidth =
    34 + streamColWidth + columns.length * COL_MAX + columns.length * GRID_GAP;

  const handleDragStart = (event: DragStartEvent) => {
    const card = cards.find((c) => c.id === event.active.id);
    setActiveDragCard(card || null);
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveDragCard(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragCard(null);

    const { active, over } = event;
    if (!over || !user) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeCard = cards.find((c) => c.id === activeId);
    if (!activeCard) return;

    // Cell ids are `${streamId}::${status}`. UUIDs contain hyphens, so a
    // hyphen is not a safe separator.
    const [targetStreamId, targetStatus] = overId.includes('::')
      ? overId.split('::')
      : [activeCard.stream_id, overId];

    if (!targetStatus) return;

    // Dropped back where it started — nothing to do.
    if (targetStreamId === activeCard.stream_id && targetStatus === activeCard.status) {
      return;
    }

    // Optimistic
    const newCards = [...cards];
    const cardIndex = newCards.findIndex(c => c.id === activeId);
    if (cardIndex === -1) return;

    const oldStreamId = newCards[cardIndex].stream_id;
    const oldStatus = newCards[cardIndex].status;

    // Remember positions before the move so we only persist what changed.
    const originalPositions = new Map(cards.map((c) => [c.id, c.position || 0]));

    newCards[cardIndex] = {
      ...newCards[cardIndex],
      stream_id: targetStreamId,
      status: targetStatus as any,
    };

    // Reindex positions in the affected cells and collect the new ordering.
    const cellsToReindex = [
      `${oldStreamId}::${oldStatus}`,
      `${targetStreamId}::${targetStatus}`
    ];

    const positionUpdates: { id: string; position: number }[] = [];
    const seen = new Set<string>();

    cellsToReindex.forEach(cell => {
      const [sId, stat] = cell.split('::');
      const cellCards = newCards
        .filter(c => c.stream_id === sId && c.status === stat)
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      cellCards.forEach((c, idx) => {
        const idxInArray = newCards.findIndex(item => item.id === c.id);
        if (idxInArray !== -1) {
          newCards[idxInArray] = { ...newCards[idxInArray], position: idx };
        }
        if (!seen.has(c.id) && originalPositions.get(c.id) !== idx) {
          seen.add(c.id);
          positionUpdates.push({ id: c.id, position: idx });
        }
      });
    });

    setCards(newCards);

    try {
      const { data: movedCard, error } = await supabase
        .from('cards')
        .update({ 
          stream_id: targetStreamId, 
          status: targetStatus,
          position: newCards[cardIndex].position 
        })
        .eq('id', activeId)
        .select()
        .single();
      if (error) throw error;
      setCards(prev => prev.map(c => c.id === activeId ? movedCard : c));

      // Persist the reordering of the other cards in the affected cells so
      // the order survives a reload. (Individual updates: an upsert would
      // need every NOT NULL column.)
      if (positionUpdates.length > 0) {
        await Promise.all(
          positionUpdates
            .filter((u) => u.id !== activeId)
            .map((u) =>
              supabase.from('cards').update({ position: u.position }).eq('id', u.id)
            )
        );
      }

      if (activeCard.is_recurring && activeCard.recurrence_source_id) {
        await supabase
          .from('recurrence_sources')
          .update({ stream_id: targetStreamId })
          .eq('id', activeCard.recurrence_source_id);
      }

      if (activeCard.is_recurring && ['complete', 'canceled'].includes(targetStatus)) {
        await loadData(user.id);
      }

      toast.success('Moved');
    } catch (err) {
      console.error(err);
      toast.error('Move failed');
      setCards(cards);
    }
  };

  const handleCardCreated = (newCard: Card) => {
    setCards((prev) => [...prev, newCard]);
  };

  const handleCardUpdated = async (updatedCard: Card) => {
    setCards((prev) =>
      prev.map((c) => (c.id === updatedCard.id ? updatedCard : c))
    );
    if (updatedCard.is_recurring && user) {
      await loadData(user.id);
    }
  };

  const handleCardDeleted = (cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const handleStreamCreated = (newStream: Stream) => {
    setStreams((prev) => {
      const unc = prev.find((s) => s.title === 'Uncategorized');
      const others = prev.filter((s) => s.title !== 'Uncategorized');
      const updated = [...others, newStream];
      if (unc) updated.push(unc);
      return updated.sort((a, b) => a.position - b.position);
    });
  };

  const handleStreamUpdated = (updatedStream: Stream) => {
    setStreams((prev) =>
      prev.map((s) => (s.id === updatedStream.id ? updatedStream : s))
    );
  };

  const handleStreamDeleted = (streamId: string, targetStreamId?: string) => {
    if (targetStreamId) {
      setCards((prev) =>
        prev.map((c) =>
          c.stream_id === streamId ? { ...c, stream_id: targetStreamId } : c
        )
      );
    }
    setStreams((prev) => prev.filter((s) => s.id !== streamId));
  };

  const handleCompleteCard = async (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const newStatus = 'complete';
    const completedAt = new Date().toISOString();

    // Optimistic
    setCards(prev => prev.map(c => 
      c.id === cardId ? { ...c, status: newStatus as any, completed_at: completedAt } : c
    ));

    try {
      const { data: updatedCard, error } = await supabase
        .from('cards')
        .update({ status: newStatus })
        .eq('id', cardId)
        .select()
        .single();
      if (error) throw error;

      // The database stamps completion and updates the source atomically.
      await handleCardUpdated(updatedCard);

      toast.success('Card completed');
    } catch (err) {
      console.error(err);
      setCards(prev => prev.map(c => c.id === cardId ? card : c));
      toast.error('Failed to complete');
    }
  };

  const handleAdvanceCard = async (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const next = nextStatus(card.status);
    if (!next) return;

    // Landing on complete goes through the full completion path so
    // completed_at and recurring-bookkeeping stay consistent.
    if (next === 'complete') {
      return handleCompleteCard(cardId);
    }

    // Optimistic
    setCards(prev => prev.map(c =>
      c.id === cardId ? { ...c, status: next } : c
    ));

    try {
      await supabase.from('cards').update({ status: next }).eq('id', cardId);
      toast.success(`Moved to ${STATUS_LABELS[next]}`);
    } catch (err) {
      console.error(err);
      // Revert on failure
      setCards(prev => prev.map(c =>
        c.id === cardId ? { ...c, status: card.status } : c
      ));
      toast.error('Failed to move card');
    }
  };

  const handleStreamStateChange = async (streamId: string, newState: Stream['state']): Promise<boolean> => {
    const stream = streams.find(s => s.id === streamId);
    if (!stream || stream.state === newState) return true;

    // Check for active recurrences if going to complete/canceled
    if (['complete', 'canceled'].includes(newState)) {
      const activeRecurring = cards.filter(c => 
        c.stream_id === streamId && 
        c.is_recurring && 
        !['complete', 'canceled'].includes(c.status) &&
        c.recurrence_source_id
      );

      if (activeRecurring.length > 0) {
        const uniqueSources = [...new Set(activeRecurring.map(c => c.recurrence_source_id))];
        const proceed = confirm(
          `This stream has ${uniqueSources.length} active recurring task(s). ` +
          `Changing state to ${newState} may affect future instances. Proceed?`
        );
        if (!proceed) return false;

        // For simplicity in this build: stop the recurrences
        for (const sourceId of uniqueSources) {
          await supabase
            .from('recurrence_sources')
            .update({ stopped_at: new Date().toISOString() })
            .eq('id', sourceId);
        }
        toast.info('Recurring tasks stopped for this stream.');
      }
    }

    // Optimistic
    setStreams(prev => prev.map(s => s.id === streamId ? { ...s, state: newState } : s));

    try {
      await supabase.from('streams').update({ state: newState }).eq('id', streamId);
      toast.success(`Stream marked as ${newState}`);
      return true;
    } catch (err) {
      console.error(err);
      toast.error('Failed to update stream state');
      setStreams(streams); // revert
      return false;
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-ink-soft">
        <div>Loading your workspace...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-50">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="font-semibold text-xl tracking-tight text-ink">Will Do It</h1>
          </div>

          <div className="flex items-center gap-4">
            <AreaFilter value={activeFilter} onChange={setActiveFilter} />

            <button
              onClick={() => setShowAddModal(true)}
              className="btn btn-primary px-4 py-1.5 text-sm"
            >
              <Plus className="h-4 w-4" /> Quick Add
            </button>

            <button
              onClick={() => setShowStreamModal(true)}
              className="btn btn-secondary px-3 py-1.5 text-sm"
            >
              New Stream
            </button>

            <ThemeToggle />

            <button onClick={handleSignOut} className="btn btn-ghost p-2">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* View switcher lives in its own stable bar so it never shifts
          horizontally when the number of columns changes between views. */}
      <div className="sticky top-14 z-40 border-b border-line bg-surface/80 backdrop-blur">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-center">
          <div className="flex rounded-lg border border-line overflow-hidden bg-surface shadow-sm">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`px-4 sm:px-6 py-2 text-base transition-colors whitespace-nowrap ${
                  view === v.id
                    ? 'bg-accent text-accent-ink'
                    : 'text-ink-soft hover:text-ink hover:bg-sunken'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <div className="space-y-3 mx-auto" style={{ maxWidth: matrixMaxWidth }}>
            <div
              className="grid gap-3 px-4 border border-transparent"
              style={{ gridTemplateColumns: gridColumns }}
            >
              <div className="font-medium text-sm px-3 text-ink-soft">Stream</div>
              {columns.map((status) => (
                <div key={status} className="status-column">
                  <StatusHeader status={status} />
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
                      className="grid gap-3"
                      style={{ gridTemplateColumns: gridColumns }}
                    >
                      <div className="pr-4">
                        <div className="font-medium flex flex-wrap items-center gap-2 text-ink">
                          <span className="cursor-pointer hover:underline break-words min-w-0" onClick={() => stream.title !== "Uncategorized" && setEditingStream(stream)}>{stream.title}</span>
                          {stream.area !== 'neutral' && (
                            <span className="text-[10px] px-1.5 py-px rounded bg-sunken text-ink-muted">
                              {stream.area}
                            </span>
                          )}
                          {stream.state !== 'in_progress' && (
                            <span className="text-[10px] px-1.5 py-px rounded bg-sunken text-ink-muted">
                              {stream.state === 'complete' ? 'Complete' : 'Canceled'}
                            </span>
                          )}
                        </div>
                      </div>

                      {columns.map((status) => {
                        const cellCards = streamCards.filter((c) => c.status === status);
                        const cellId = `${stream.id}::${status}`;

                        return (
                          <div key={status} className="status-column h-full">
                            <DroppableCell id={cellId} isEmpty={cellCards.length === 0}>
                              <div className="space-y-2">
                                {cellCards.map((card) => (
                                  <CardComponent 
                                    key={card.id} 
                                    card={card} 
                                    onClick={() => setEditingCard(card)} 
                                     onComplete={handleCompleteCard}
                                     onAdvance={handleAdvanceCard}
                                  />
                                ))}
                              </div>
                            </DroppableCell>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-ink-soft">
                No streams with cards in this view.
              </div>
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDragCard ? (
              <div className="w-64 max-w-full">
                <CardComponent card={activeDragCard} overlay />
              </div>
            ) : null}
          </DragOverlay>
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

        {showStreamModal && (
          <AddStreamModal
            streams={streams}
            onClose={() => setShowStreamModal(false)}
            onStreamCreated={handleStreamCreated}
          />
        )}

        {editingStream && (
          <EditStreamModal
            stream={editingStream}
            streams={streams}
            onClose={() => setEditingStream(null)}
            onStreamUpdated={handleStreamUpdated}
            onStreamDeleted={handleStreamDeleted}
            onStateChange={handleStreamStateChange}
          />
        )}
      </div>
    </div>
  );
}
