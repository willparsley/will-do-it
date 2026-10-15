'use client';

import { AppSelect } from '@/components/AppSelect';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
  DndContext, 
  closestCenter, 
  MouseSensor, 
  TouchSensor, 
  useSensor, 
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { createClient } from '@/lib/supabase/client';
import { Stream, Card, RecurrenceSource, Area, streamsForDisplay, nextStatus, STATUS_LABELS } from '@/lib/types';
import { AreaFilter } from '@/components/AreaFilter';
import { AddCardModal } from '@/components/AddCardModal';
import { Card as CardComponent } from '@/components/Card';
import { DroppableCell } from '@/components/DroppableCell';
import { StatusHeader } from '@/components/StatusHeader';
import { EditCardModal } from '@/components/EditCardModal';
import { EditRecurrenceModal } from '@/components/EditRecurrenceModal';
import { AddStreamModal } from '@/components/AddStreamModal';
import { EditStreamModal } from '@/components/EditStreamModal';
import { Plus, LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from 'sonner';
import type { User } from '@supabase/supabase-js';
import { ArchiveCards } from '@/components/ArchiveCards';
import { ArchivePeriod, View, cardsForStream, displayStreamId, hydrateRecurringCards, statusesForView } from '@/lib/card-views';
import { errorMessage } from '@/lib/errors';

const supabase = createClient();

const VIEWS = [
  { id: 'activated', label: 'Active' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'all', label: 'All' },
  { id: 'archive', label: 'Archive' },
] as const;

export default function WillDoIt() {
  const [user, setUser] = useState<User | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [recurrenceSources, setRecurrenceSources] = useState<RecurrenceSource[]>([]);
  const [archivePeriod, setArchivePeriod] = useState<ArchivePeriod>('month');
  const loadSequence = useRef(0);
  const [activeFilter, setActiveFilter] = useState<Area | 'all'>('all');
  const [view, setView] = useState<View>('activated');
  const [initialLoading, setInitialLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editingRecurrenceId, setEditingRecurrenceId] = useState<string | null>(null);
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

  const loadData = useCallback(async (userId: string, processTasks = true) => {
    const sequence = ++loadSequence.current;
    // Keep the workspace mounted during mutation-triggered refreshes. Only the
    // first load needs a full-screen placeholder; later loads update it in place.
    try {
      const { data: streamsData, error: streamsError } = await supabase
        .from('streams').select('*').eq('user_id', userId).order('position', { ascending: true });
      if (streamsError) throw streamsError;
      let loadedStreams = (streamsData || []) as Stream[];
      if (!loadedStreams.some(s => s.title === 'Uncategorized')) {
        const { data: uncategorized, error } = await supabase.from('streams').insert({
          user_id: userId, title: 'Uncategorized', state: 'in_progress', area: 'neutral', position: 999,
        }).select().single<Stream>();
        if (error) throw error;
        loadedStreams = [...loadedStreams, uncategorized];
      }
      // Retain the existing compatibility path for duplicate system streams.
      let seenUncategorized = false;
      loadedStreams = loadedStreams.filter(s => {
        if (s.title !== 'Uncategorized') return true;
        if (seenUncategorized) return false;
        seenUncategorized = true;
        return true;
      });
      const legacyIds = loadedStreams.filter(s => String(s.state) === 'backlog').map(s => s.id);
      if (legacyIds.length > 0) {
        const { error } = await supabase.from('streams').update({ state: 'in_progress' }).in('id', legacyIds);
        if (error) throw error;
        loadedStreams = loadedStreams.map(s => legacyIds.includes(s.id) ? { ...s, state: 'in_progress' } : s);
      }
      if (processTasks) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { error: recurrenceError } = await supabase.rpc('generate_recurring_instances', { p_timezone: timezone });
        if (recurrenceError) toast.error(errorMessage(recurrenceError, 'Could not refresh recurring tasks'));
        const { error: promotionError } = await supabase.rpc('promote_due_cards', { p_timezone: timezone });
        if (promotionError) toast.error(errorMessage(promotionError, 'Could not refresh reminders'));
      }

      const [cardResult, sourceResult] = await Promise.all([
        supabase.from('cards').select('*').eq('user_id', userId),
        supabase.from('recurrence_sources').select('*').eq('user_id', userId),
      ]);
      if (cardResult.error) throw cardResult.error;
      if (sourceResult.error) throw sourceResult.error;
      if (sequence !== loadSequence.current) return;
      const sources = (sourceResult.data || []) as RecurrenceSource[];
      setRecurrenceSources(sources);
      setStreams(loadedStreams);
      setCards(hydrateRecurringCards((cardResult.data || []) as Card[], sources));
    } catch (error) {
      if (sequence === loadSequence.current) toast.error(errorMessage(error, 'Could not load your workspace'));
    } finally {
      if (sequence === loadSequence.current) setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        window.location.replace('/login');
        return;
      }
      try {
        const preferences = JSON.parse(localStorage.getItem(`will-do-it:workspace:${user.id}`) || 'null');
        if (preferences && typeof preferences === 'object') {
          const savedView = VIEWS.find(option => option.id === preferences.view);
          if (savedView) setView(savedView.id);
          if (['all', 'work', 'personal'].includes(preferences.area)) setActiveFilter(preferences.area);
          if (['month', 'year', 'all'].includes(preferences.archivePeriod)) setArchivePeriod(preferences.archivePeriod);
        }
      } catch {
        // Unavailable storage or invalid saved settings must not prevent loading.
      }
      setUser(user);
      await loadData(user.id);
    };
    void init();
  }, [loadData]);

  const savePreferences = (changes: Partial<{ view: View; area: Area | 'all'; archivePeriod: ArchivePeriod }>) => {
    if (!user) return;
    try {
      localStorage.setItem(`will-do-it:workspace:${user.id}`, JSON.stringify({ view, area: activeFilter, archivePeriod, ...changes }));
    } catch {
      // The selected view still works when browser storage is unavailable.
    }
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
    return cardsForStream(cards, streamId, view, archivePeriod);
  }

  const columns = statusesForView(view);

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

  const saveQuickAction = async (card: Card, changes: Partial<Card>) => {
    const { data, error } = await supabase.rpc('save_card_with_undo', {
      p_card_id: card.id,
      p_expected_status: card.status,
      p_changes: changes,
      p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (error) throw error;
    return data as { card: Card; undo_id: string };
  };

  const showUndoToast = (message: string, undoId: string) => {
    let undoing = false;
    const toastId = toast.success(message, {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: async () => {
          if (undoing || !user) return;
          undoing = true;
          // Sonner dismisses the action toast after this callback returns.
          // Use a separate toast for the asynchronous result.
          const pendingId = toast.loading('Undoing…');
          try {
            const { error } = await supabase.rpc('undo_card_action', { p_undo_id: undoId });
            if (error) throw error;
            // Preserve the restored status until the next normal refresh.
            await loadData(user.id, false);
            toast.success('Undone', { id: pendingId });
          } catch (error) {
            toast.error(errorMessage(error, 'Could not undo'), { id: pendingId });
            await loadData(user.id, false);
          } finally {
            toast.dismiss(toastId);
          }
        },
      },
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const card = cards.find((c) => c.id === event.active.id);
    setActiveDragCard(card || null);
  };

  const handleDragCancel = () => {
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
    if (targetStreamId === displayStreamId(activeCard) && targetStatus === activeCard.status) {
      return;
    }

    // Optimistic
    const newCards = [...cards];
    const cardIndex = newCards.findIndex(c => c.id === activeId);
    if (cardIndex === -1) return;

    // Append in the destination without renumbering siblings, so Undo only
    // needs to restore this card and any recurrence siblings that followed it.
    newCards[cardIndex] = {
      ...activeCard,
      stream_id: targetStreamId,
      status: targetStatus as Card['status'],
      position: Math.max(-1, ...cards.filter(c => c.id !== activeId && c.stream_id === targetStreamId && c.status === targetStatus)
        .map(c => c.position || 0)) + 1,
    };

    setCards(newCards);

    try {
      await saveQuickAction(activeCard, {
        stream_id: targetStreamId, status: targetStatus as Card['status'], position: newCards[cardIndex].position,
      });
      await loadData(user.id, false);
    } catch (err) {
      console.error(err);
      setCards(cards);
      toast.error(errorMessage(err, 'Move failed'));
      await loadData(user.id);
    }
  };

  const handleCardCreated = async (newCard: Card) => {
    setCards((prev) => [...prev, newCard]);
    if (user) await loadData(user.id);
  };

  const handleCardUpdated = async (updatedCard: Card) => {
    setCards((prev) =>
      prev.map((c) => (c.id === updatedCard.id ? hydrateRecurringCards([updatedCard], recurrenceSources)[0] : c))
    );
    if (user) {
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

  const handleStreamUpdated = async (updatedStream: Stream) => {
    setStreams((prev) =>
      prev.map((s) => (s.id === updatedStream.id ? updatedStream : s))
    );
    if (user) await loadData(user.id);
  };

  const handleStreamDeleted = async (streamId: string, targetStreamId?: string) => {
    if (targetStreamId) {
      setCards((prev) =>
        prev.map((c) =>
          c.stream_id === streamId ? { ...c, stream_id: targetStreamId } : c
        )
      );
    }
    setStreams((prev) => prev.filter((s) => s.id !== streamId));
    if (user) await loadData(user.id);
  };

  const handleCompleteCard = async (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const newStatus = 'complete';
    const completedAt = new Date().toISOString();

    // Optimistic
    setCards(prev => prev.map(c => 
      c.id === cardId ? { ...c, status: newStatus, completed_at: completedAt } : c
    ));

    try {
      const result = await saveQuickAction(card, { status: newStatus });
      if (user) await loadData(user.id, false);
      showUndoToast('Card completed', result.undo_id);
    } catch (err) {
      console.error(err);
      setCards(prev => prev.map(c => c.id === cardId ? card : c));
      toast.error(errorMessage(err, 'Failed to complete'));
      if (user) await loadData(user.id);
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
      const result = await saveQuickAction(card, { status: next });
      if (user) await loadData(user.id, false);
      showUndoToast(`Moved to ${STATUS_LABELS[next]}`, result.undo_id);
    } catch (err) {
      console.error(err);
      // Revert on failure
      setCards(prev => prev.map(c =>
        c.id === cardId ? { ...c, status: card.status } : c
      ));
      toast.error(errorMessage(err, 'Failed to move card'));
      if (user) await loadData(user.id);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.replace('/login');
  };

  const openRecurrenceEditor = (sourceId: string) => {
    setEditingCard(null);
    setEditingRecurrenceId(sourceId);
  };

  const renderCard = (card: Card) => (
    <CardComponent key={card.id} card={card} onClick={() => setEditingCard(card)}
      onComplete={handleCompleteCard} onAdvance={handleAdvanceCard} onEditRecurrence={openRecurrenceEditor} />
  );

  if (initialLoading || !user) {
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
            <AreaFilter value={activeFilter} onChange={area => { setActiveFilter(area); savePreferences({ area }); }} />

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
                onClick={() => { setView(v.id); savePreferences({ view: v.id }); }}
                aria-pressed={view === v.id}
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
        {view === 'archive' && (
          <div className="flex justify-center pb-3 px-4">
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <span>Archive period</span>
              <AppSelect
                className="w-auto"
                size="small"
                value={archivePeriod}
                onValueChange={value => {
                  const archivePeriod = value as ArchivePeriod;
                  setArchivePeriod(archivePeriod);
                  savePreferences({ archivePeriod });
                }}
                aria-label="Archive period"
                options={[{ value: 'month', label: 'Past month' }, { value: 'year', label: 'Past 1 year' }, { value: 'all', label: 'All time' }]}
              />
            </div>
          </div>
        )}
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
                                {view === 'archive'
                                  ? <ArchiveCards cards={cellCards} renderCard={renderCard} />
                                  : cellCards.map(renderCard)}
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
            onEditRecurrence={openRecurrenceEditor}
          />
        )}

        {editingRecurrenceId && (
          <EditRecurrenceModal
            sourceId={editingRecurrenceId}
            streams={streams}
            onClose={() => setEditingRecurrenceId(null)}
            onRecurrenceUpdated={() => { if (user) void loadData(user.id); }}
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
          />
        )}
      </div>
    </div>
  );
}
