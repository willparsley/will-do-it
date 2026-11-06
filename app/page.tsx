'use client';

import { BrandLogo } from '@/components/BrandLogo';
import { AppSelect } from '@/components/AppSelect';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { 
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import { createClient } from '@/lib/supabase/client';
import { watchAccount } from '@/lib/supabase/account-boundary';
import { Stream, Card, CardStatus, RecurrenceSource, Area, nextStatus, STATUS_LABELS } from '@/lib/types';
import { AreaFilter } from '@/components/AreaFilter';
import { StreamTitle } from '@/components/StreamTitle';
import { AddCardModal } from '@/components/AddCardModal';
import { Card as CardComponent } from '@/components/Card';
import { DroppableCell } from '@/components/DroppableCell';
import { StatusHeader } from '@/components/StatusHeader';
import { EditCardModal } from '@/components/EditCardModal';
import { EditRecurrenceModal } from '@/components/EditRecurrenceModal';
import { AddStreamModal } from '@/components/AddStreamModal';
import { EditStreamModal } from '@/components/EditStreamModal';
import { ArrowUpRight, Plus } from 'lucide-react';
import { AccountMenu } from '@/components/AccountMenu';
import { TooltipButton } from '@/components/TooltipButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { toast } from 'sonner';
import type { User } from '@supabase/supabase-js';
import { DEFAULT_HISTORY_LIMIT, HISTORY_LIMIT_EVENT, readHistoryLimit, type HistoryLimit } from '@/lib/history-preferences';
import { ArchiveCards } from '@/components/ArchiveCards';
import { ArchivePeriod, HISTORY_PERIODS, View, cardsForStream, displayStreamId, hydrateRecurringCards, statusesForView } from '@/lib/card-views';
import { MobileAddMenu, MobileCards, MobileLayoutControls, MOBILE_LAYOUTS, type MobileLayout } from '@/components/MobileWorkspace';
import { MoveCardModal } from '@/components/MoveCardModal';
import { AreaIndicator } from '@/components/AreaIndicator';
import { errorMessage } from '@/lib/errors';
import { useStreamOrder } from '@/components/useStreamOrder';
import { StreamOrdering, SortableStreamRow } from '@/components/StreamOrdering';
import { clearOfflineWorkspace, OFFLINE_ACCOUNT_KEY, saveOfflineWorkspace } from '@/lib/offline-workspace';
import { watchWorkspaceRefresh } from '@/lib/workspace-refresh';

const supabase = createClient();

const VIEWS = [
  { id: 'activated', label: 'Active' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'all', label: 'All' },
  { id: 'archive', label: 'Archive' },
] as const;

export default function WillDoIt() {
  const [offlineSaveFailed, setOfflineSaveFailed] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const preferencesAccount = useRef<string | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [recurrenceSources, setRecurrenceSources] = useState<RecurrenceSource[]>([]);
  const [archivePeriod, setArchivePeriod] = useState<ArchivePeriod>('week');
  const [historyLimit, setHistoryLimit] = useState<HistoryLimit>(DEFAULT_HISTORY_LIMIT);
  const [hideRecurring, setHideRecurring] = useState(false);
  const [mobileLayout, setMobileLayout] = useState<MobileLayout>('status');
  const [desktopLayout, setDesktopLayout] = useState<MobileLayout>('board');
  const [mobileViewport, setMobileViewport] = useState(false);
  const [movingCard, setMovingCard] = useState<Card | null>(null);
  const layout = mobileViewport ? mobileLayout : desktopLayout;
  const compact = layout !== 'board';
  const statusDragEnabled = !mobileViewport && layout === 'status';
  const loadSequence = useRef(0);
  const accountActive = useRef(true);
  const loadsInFlight = useRef(0);
  const mutationsInFlight = useRef(0);
  const dragging = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Area | 'all'>('all');
  const [view, setView] = useState<View>('activated');
  const [initialLoading, setInitialLoading] = useState(true);
  const [creationContext, setCreationContext] = useState<{ streamId?: string; status: CardStatus } | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editingRecurrenceId, setEditingRecurrenceId] = useState<string | null>(null);
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [touchMode, setTouchMode] = useState(false);
  const touchInput = useRef(false);
  const suppressCardClick = useRef(false);
  const [activeDragCard, setActiveDragCard] = useState<Card | null>(null);

  const loadData = useCallback(async (userId: string, processTasks = true, background = false) => {
    if (!accountActive.current || (background && (loadsInFlight.current > 0 || mutationsInFlight.current > 0 || dragging.current))) return;
    ++loadsInFlight.current;
    const sequence = ++loadSequence.current;
    // Keep controls and editors mounted; only the board has an initial placeholder.
    try {
      const { data: streamsData, error: streamsError } = await supabase
        .from('streams').select('*').eq('user_id', userId).order('position', { ascending: true });
      if (sequence !== loadSequence.current) return;
      if (streamsError) throw streamsError;
      let loadedStreams = (streamsData || []) as Stream[];
      if (!background && !loadedStreams.some(s => s.title === 'Uncategorized')) {
        const { data: uncategorized, error } = await supabase.from('streams').insert({
          user_id: userId, title: 'Uncategorized', state: 'in_progress', area: 'neutral', position: 999,
        }).select().single<Stream>();
        if (sequence !== loadSequence.current) return;
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
      if (!background && legacyIds.length > 0) {
        const { error } = await supabase.from('streams').update({ state: 'in_progress' }).in('id', legacyIds);
        if (sequence !== loadSequence.current) return;
        if (error) throw error;
        loadedStreams = loadedStreams.map(s => legacyIds.includes(s.id) ? { ...s, state: 'in_progress' } : s);
      }
      if (processTasks) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { error: recurrenceError } = await supabase.rpc('generate_recurring_instances', { p_timezone: timezone });
        if (sequence !== loadSequence.current) return;
        if (recurrenceError) toast.error(errorMessage(recurrenceError, 'Could not refresh recurring tasks'));
        const { error: promotionError } = await supabase.rpc('promote_due_cards', { p_timezone: timezone });
        if (sequence !== loadSequence.current) return;
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
      if (background && (mutationsInFlight.current > 0 || dragging.current)) return;
      setLoadFailed(false);
      setRecurrenceSources(sources);
      setStreams(loadedStreams);
      const loadedCards = hydrateRecurringCards((cardResult.data || []) as Card[], sources);
      setCards(loadedCards);
      setOfflineSaveFailed(!saveOfflineWorkspace(userId, loadedStreams, loadedCards));
    } catch (error) {
      if (sequence === loadSequence.current && !background) {
        setLoadFailed(true);
        toast.error(errorMessage(error, 'Could not load your workspace'));
      }
    } finally {
      --loadsInFlight.current;
      if (sequence === loadSequence.current) setInitialLoading(false);
    }
  }, []);

  const restorePreferences = useCallback((userId: string) => {
    // The cached identity is only a hint for display settings. Auth still gates
    // all account data, and a different verified account restores its own defaults.
    if (preferencesAccount.current === userId) return;
    let saved: Record<string, unknown> = {};
    try {
      const value = JSON.parse(localStorage.getItem(`will-do-it:workspace:${userId}`) || 'null');
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
    } catch { /* Invalid/unavailable storage falls back to the normal defaults. */ }
    setView(VIEWS.find(option => option.id === saved.view)?.id || 'activated');
    setActiveFilter(saved.area === 'work' || saved.area === 'personal' ? saved.area : 'all');
    setArchivePeriod(HISTORY_PERIODS.find(option => option.value === saved.archivePeriod)?.value || 'week');
    setMobileLayout((MOBILE_LAYOUTS.find(option => option.value === saved.mobileLayout)?.value as MobileLayout) || 'status');
    setDesktopLayout((MOBILE_LAYOUTS.find(option => option.value === saved.desktopLayout)?.value as MobileLayout) || 'board');
    setHideRecurring(saved.hideRecurring === true);
    preferencesAccount.current = userId;
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    accountActive.current = true;
    const cancelLoads = () => { accountActive.current = false; ++loadSequence.current; };
    const boundary = watchAccount(supabase, signedOut => {
      accountActive.current = false;
      ++loadSequence.current;
      setUser(null);
      setPreferencesReady(false);
      setCards([]);
      setStreams([]);
      setRecurrenceSources([]);
      setCreationContext(null);
      setEditingCard(null);
      setMovingCard(null);
      setEditingRecurrenceId(null);
      setShowStreamModal(false);
      setEditingStream(null);
      setSelectedCardId(null);
      setActiveDragCard(null);
      toast.dismiss();
      window.location.replace(signedOut ? '/login' : '/');
    });
    const init = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!boundary.active) return;
      if (error && (error.name === 'AuthRetryableFetchError' || error.status === 0 || navigator.onLine === false)) {
        // A connection failure is not a sign-out. Keep the saved account copy.
        window.location.replace('/offline.html');
        return;
      }
      if (error || !user) {
        clearOfflineWorkspace();
        window.location.replace('/login');
        return;
      }
      if (!boundary.acceptUser(user.id)) return;
      restorePreferences(user.id);
      setUser(user);
      await loadData(user.id);
    };
    void init();
    return () => {
      cancelLoads();
      boundary.dispose();
    };
  }, [loadData, restorePreferences]);

  useLayoutEffect(() => {
    // Read local display preferences before paint, without waiting for getUser.
    // This marker is cleared on sign-out and replaced at account boundaries.
    try {
      const userId = localStorage.getItem(OFFLINE_ACCOUNT_KEY);
      if (userId) restorePreferences(userId);
    } catch { /* Auth will restore defaults if browser storage is unavailable. */ }
  }, [restorePreferences]);

  useEffect(() => {
    if (!user) return;
    // Background reconciliation only reads: it must not re-promote a just-undone
    // card or run recurrence writes every minute.
    return watchWorkspaceRefresh(() => loadData(user.id, false, true));
  }, [user, loadData]);

  useEffect(() => {
    if (!user) return;
    const update = () => setHistoryLimit(readHistoryLimit(user.id));
    update();
    window.addEventListener('storage', update);
    window.addEventListener(HISTORY_LIMIT_EVENT, update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(HISTORY_LIMIT_EVENT, update);
    };
  }, [user]);

  const savePreferences = (changes: Partial<{ view: View; area: Area | 'all'; archivePeriod: ArchivePeriod; hideRecurring: boolean; mobileLayout: MobileLayout; desktopLayout: MobileLayout }>) => {
    const userId = user?.id || preferencesAccount.current;
    if (!userId) return;
    try {
      localStorage.setItem(`will-do-it:workspace:${userId}`, JSON.stringify({ view, area: activeFilter, archivePeriod, hideRecurring, ...(mobileLayout !== 'status' ? { mobileLayout } : {}), ...(desktopLayout !== 'board' ? { desktopLayout } : {}), ...changes }));
    } catch {
      // The selected view still works when browser storage is unavailable.
    }
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const media = window.matchMedia('(max-width: 767px)');
    const resize = () => setMobileViewport(media.matches);
    resize();
    media.addEventListener('change', resize);
    const pointer = (event: PointerEvent) => {
      touchInput.current = event.pointerType === 'touch' || event.pointerType === 'pen';
      setTouchMode(touchInput.current);
      suppressCardClick.current = false;
      const target = event.target as Element;
      if (!target.closest('[data-card-id]')) setSelectedCardId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCardId(null);
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', escape);
    return () => {
      media.removeEventListener('change', resize);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const streamOrder = useStreamOrder(user?.id, streams);

  const visibleCards = hideRecurring
    ? cards.filter(card => !card.is_recurring && !card.recurrence_source_id)
    : cards;

  const filteredStreams = streamOrder.streams.filter((stream) => {
    if (activeFilter !== 'all' && stream.area !== activeFilter && stream.area !== 'neutral') {
      return false;
    }
    return getCardsForStream(stream.id).length > 0;
  });

  function getCardsForStream(streamId: string): Card[] {
    return cardsForStream(visibleCards, streamId, view, archivePeriod);
  }

  // Adjust transient selection before rendering a changed workspace context.
  const selectionContext = [mobileViewport, layout, movingCard?.id, view, activeFilter, archivePeriod, hideRecurring, editingCard?.id,
    editingRecurrenceId, !!creationContext, showStreamModal, editingStream?.id].join(':');
  const [previousSelectionContext, setPreviousSelectionContext] = useState(selectionContext);
  if (previousSelectionContext !== selectionContext) {
    setPreviousSelectionContext(selectionContext);
    if (selectedCardId) setSelectedCardId(null);
  } else if (selectedCardId && !filteredStreams.some(stream => getCardsForStream(stream.id).some(card => card.id === selectedCardId))) {
    setSelectedCardId(null);
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
  // Keep cards readable on narrow screens; the workspace scrolls horizontally.
  const gridColumns = `${streamColWidth}px repeat(${columns.length}, minmax(180px, ${COL_MAX}px))`;

  // Cap the whole matrix so row panels end where the columns end instead of
  // trailing off into empty space. The +34 accounts for a row's p-4 padding
  // (32px) and its 1px top/bottom borders.
  const matrixMaxWidth =
    34 + streamColWidth + columns.length * COL_MAX + columns.length * GRID_GAP;

  const saveQuickAction = async (card: Card, changes: Partial<Card>) => {
    ++mutationsInFlight.current;
    ++loadSequence.current;
    try {
      const { data, error } = await supabase.rpc('save_card_with_undo', {
        p_card_id: card.id,
        p_expected_status: card.status,
        p_changes: changes,
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (error) throw error;
      return data as { card: Card; undo_id: string };
    } finally {
      --mutationsInFlight.current;
    }
  };

  const showUndoToast = (message: string, undoId: string) => {
    if (!accountActive.current) return;
    let undoing = false;
    const toastId = toast.success(message, {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: async () => {
          if (undoing || !user || !accountActive.current) return;
          undoing = true;
          // Sonner dismisses the action toast after this callback returns.
          // Use a separate toast for the asynchronous result.
          const pendingId = toast.loading('Undoing…');
          ++mutationsInFlight.current;
          ++loadSequence.current;
          try {
            const { error } = await supabase.rpc('undo_card_action', { p_undo_id: undoId });
            if (!accountActive.current) return;
            if (error) throw error;
            // Preserve the restored status until the next normal refresh.
            await loadData(user.id, false);
            toast.success('Undone', { id: pendingId });
          } catch (error) {
            if (!accountActive.current) return;
            toast.error(errorMessage(error, 'Could not undo'), { id: pendingId });
            await loadData(user.id, false);
          } finally {
            --mutationsInFlight.current;
            toast.dismiss(toastId);
          }
        },
      },
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    dragging.current = true;
    ++loadSequence.current;
    suppressCardClick.current = true;
    setSelectedCardId(null);
    const card = cards.find((c) => c.id === event.active.id);
    setActiveDragCard(card || null);
  };

  const handleDragCancel = () => {
    dragging.current = false;
    setActiveDragCard(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    dragging.current = false;
    if (!accountActive.current) return;
    setActiveDragCard(null);

    const { active, over } = event;
    if (!over || !user) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeCard = cards.find((c) => c.id === activeId);
    if (!activeCard) return;

    // Cell ids are `${streamId}::${status}`. UUIDs contain hyphens, so a
    // hyphen is not a safe separator.
    const statusOnly = over.data?.current?.kind === 'status';
    const [targetStreamId, targetStatus] = statusOnly
      ? [activeCard.stream_id, over.data.current!.status as CardStatus]
      : overId.includes('::')
      ? overId.split('::')
      : [activeCard.stream_id, overId];

    if (!targetStatus || !Object.hasOwn(STATUS_LABELS, targetStatus)) return;

    // Dropped back where it started — nothing to do.
    if ((statusOnly || targetStreamId === displayStreamId(activeCard)) && targetStatus === activeCard.status) {
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
        ...(statusOnly ? {} : { stream_id: targetStreamId }), status: targetStatus as Card['status'], position: newCards[cardIndex].position,
      });
      await loadData(user.id, false);
    } catch (err) {
      if (!accountActive.current) return;
      console.error(err);
      setCards(cards);
      toast.error(errorMessage(err, 'Move failed'));
      await loadData(user.id);
    }
  };

  const handleCardCreated = async (newCard: Card) => {
    if (!accountActive.current) return;
    ++loadSequence.current;
    setCards((prev) => [...prev, newCard]);
    if (user) await loadData(user.id);
  };

  const handleCardUpdated = async (updatedCard: Card) => {
    if (!accountActive.current) return;
    ++loadSequence.current;
    setCards((prev) =>
      prev.map((c) => (c.id === updatedCard.id ? hydrateRecurringCards([updatedCard], recurrenceSources)[0] : c))
    );
    if (user) {
      await loadData(user.id);
    }
  };

  const handleCardDeleted = (cardId: string) => {
    if (!accountActive.current) return;
    ++loadSequence.current;
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const handleStreamCreated = (newStream: Stream) => {
    if (!accountActive.current) return;
    ++loadSequence.current;
    setStreams((prev) => {
      const unc = prev.find((s) => s.title === 'Uncategorized');
      const others = prev.filter((s) => s.title !== 'Uncategorized');
      const updated = [...others, newStream];
      if (unc) updated.push(unc);
      return updated.sort((a, b) => a.position - b.position);
    });
  };

  const handleStreamUpdated = async (updatedStream: Stream) => {
    if (!accountActive.current) return;
    ++loadSequence.current;
    setStreams((prev) =>
      prev.map((s) => (s.id === updatedStream.id ? updatedStream : s))
    );
    if (user) await loadData(user.id);
  };

  const handleStreamDeleted = async (streamId: string, targetStreamId?: string) => {
    if (!accountActive.current) return;
    ++loadSequence.current;
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
    if (!accountActive.current) return;
    setSelectedCardId(null);
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
      if (!accountActive.current) return;
      console.error(err);
      setCards(prev => prev.map(c => c.id === cardId ? card : c));
      toast.error(errorMessage(err, 'Failed to complete'));
      if (user) await loadData(user.id);
    }
  };

  const handleAdvanceCard = async (cardId: string) => {
    if (!accountActive.current) return;
    setSelectedCardId(null);
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
      if (!accountActive.current) return;
      console.error(err);
      // Revert on failure
      setCards(prev => prev.map(c =>
        c.id === cardId ? { ...c, status: card.status } : c
      ));
      toast.error(errorMessage(err, 'Failed to move card'));
      if (user) await loadData(user.id);
    }
  };

  const openRecurrenceEditor = (sourceId: string) => {
    setEditingCard(null);
    setEditingRecurrenceId(sourceId);
  };

  const renderCard = (card: Card) => {
    const stream = streams.find(stream => stream.id === displayStreamId(card));
    const context = layout === 'status'
      ? <span className="flex items-center gap-1.5"><AreaIndicator area={stream?.area || 'neutral'} />{stream?.title}</span>
      : <span>{STATUS_LABELS[card.status]}</span>;
    return (
    <CardComponent key={card.id} card={card} prerequisite={cards.find(other => other.id === card.prerequisite_card_id)} selected={selectedCardId === card.id} touchMode={(mobileViewport && compact) || touchMode} desktop={!mobileViewport} compact={compact} dragEnabled={!compact || statusDragEnabled}
      context={compact ? context : undefined}
      onMove={mobileViewport || compact ? () => { setSelectedCardId(null); setMovingCard(card); } : undefined}
      onEdit={event => {
        if (activeDragCard || (suppressCardClick.current && event.detail !== 0)) return;
        setSelectedCardId(null); setEditingCard(card);
      }}
      onClick={event => {
        if (activeDragCard || (suppressCardClick.current && event?.detail !== 0)) return;
        if (!mobileViewport || compact || touchInput.current || event.detail === 0) setSelectedCardId(current => current === card.id ? null : card.id);
        else { setSelectedCardId(null); setEditingCard(card); }
      }}
      onComplete={handleCompleteCard} onAdvance={handleAdvanceCard} onEditRecurrence={openRecurrenceEditor} />
    );
  };

  const filterControls = (
<div data-secondary-filters className="flex items-center justify-center gap-2 sm:gap-4 lg:min-w-[24rem] lg:justify-start">
            <button
              type="button"
              role="switch"
              aria-checked={hideRecurring}
              onClick={() => {
                const next = !hideRecurring;
                setHideRecurring(next);
                savePreferences({ hideRecurring: next });
              }}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-1 text-xs sm:text-sm font-medium text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span aria-hidden="true" className={`relative h-5 w-9 rounded-full border transition-colors ${hideRecurring ? 'border-accent bg-accent' : 'border-line-strong bg-sunken'}`}>
                <span className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full shadow-sm transition-transform ${hideRecurring ? 'translate-x-4 bg-accent-ink' : 'bg-ink-soft'}`} />
              </span>
              Hide recurring
            </button>
            {columns.some(status => status === 'complete' || status === 'canceled') && (
              <>
                <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
                <AppSelect
                  className="w-[11rem] shrink-0 sm:w-[12.5rem]"
                  size="small"
                  valuePrefix="History"
                  value={archivePeriod}
                  onValueChange={value => {
                    const archivePeriod = value as ArchivePeriod;
                    setArchivePeriod(archivePeriod);
                    savePreferences({ archivePeriod });
                  }}
                  aria-label="Completed/canceled period"
                  options={[...HISTORY_PERIODS]}
                />
              </>
            )}
          </div>
  );

  return (
    <div className="h-dvh overflow-hidden flex flex-col">
      <header className="workspace-header relative shrink-0 border-b border-line bg-chrome/80 backdrop-blur z-50">
        <div className="w-full px-4 sm:px-6 lg:px-8 min-h-14 py-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <h1 className="shrink-0"><BrandLogo /></h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="hidden md:block" style={{ visibility: preferencesReady ? undefined : 'hidden' }}>{!mobileViewport && <AreaFilter value={activeFilter} onChange={area => { setActiveFilter(area); savePreferences({ area }); }} />}</div>

            <div className="hidden md:flex gap-2 sm:gap-4"><TooltipButton
              isDisabled={initialLoading || !user || streams.length === 0}
              tooltip="Add a new card"
              onPress={() => setCreationContext({ status: 'backlog' })}
              className="btn btn-primary px-4 py-1.5 text-sm"
            >
              <Plus className="h-4 w-4" /> Quick Add
            </TooltipButton>

            <TooltipButton
              isDisabled={initialLoading || !user || streams.length === 0}
              tooltip="Create a stream to organize your cards"
              onPress={() => setShowStreamModal(true)}
              className="btn btn-secondary px-3 py-1.5 text-sm"
            >
              New Stream
            </TooltipButton></div>
            <div className="md:hidden"><MobileAddMenu disabled={initialLoading || !user || streams.length === 0} onCard={() => setCreationContext({ status: 'backlog' })} onStream={() => setShowStreamModal(true)} /></div>

            <ThemeToggle />

            <AccountMenu email={user?.email} disabled={!user} />
          </div>
        </div>
      </header>

      {offlineSaveFailed && <p role="status" className="shrink-0 px-4 py-2 text-sm bg-sunken text-ink-soft">Offline viewing is unavailable because this browser could not save a local copy. Your online workspace still works.</p>}

      {/* View switcher lives in its own stable bar so it never shifts
          horizontally when the number of columns changes between views. */}
      <div data-workspace-toolbar data-preferences-ready={preferencesReady} className="relative shrink-0 z-40 border-b border-line bg-chrome/80 backdrop-blur" style={{ visibility: preferencesReady ? undefined : 'hidden' }}>
        <div className="w-full px-4 sm:px-6 lg:px-8 min-h-14 py-2 flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:gap-x-6 lg:gap-y-1 items-center justify-center">
          <div role="group" aria-label="Board view" className="flex rounded-lg border border-line overflow-hidden bg-surface shadow-sm">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => { setView(v.id); savePreferences({ view: v.id }); }}
                aria-pressed={view === v.id}
                className={`px-4 sm:px-6 py-2 text-base whitespace-nowrap ${initialLoading ? '' : 'transition-colors'} ${
                  view === v.id
                    ? 'bg-accent text-accent-ink'
                    : 'text-ink-soft hover:text-ink hover:bg-sunken'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-4">{!mobileViewport && <>
            {filterControls}
            <AppSelect aria-label="Desktop layout" size="small" className="w-40" value={desktopLayout}
              onValueChange={value => { const desktopLayout = value as MobileLayout; setDesktopLayout(desktopLayout); savePreferences({ desktopLayout }); }}
              options={[MOBILE_LAYOUTS[2], MOBILE_LAYOUTS[0], MOBILE_LAYOUTS[1]]} />
            {compact && <Link href="/streams" className="text-sm text-ink-soft hover:text-ink hover:underline focus-ring whitespace-nowrap">All streams</Link>}
          </>}</div>
          <div className="w-full md:hidden"><MobileLayoutControls layout={mobileLayout} onLayout={layout => { setMobileLayout(layout); savePreferences({ mobileLayout: layout }); }} filterCount={(activeFilter !== 'all' ? 1 : 0) + (hideRecurring ? 1 : 0) + (columns.includes('complete') && archivePeriod !== 'week' ? 1 : 0)} filters={<><AreaFilter value={activeFilter} onChange={area => { setActiveFilter(area); savePreferences({ area }); }} />{filterControls}</>} /></div>
        </div>
      </div>

      {/* One scroll container keeps sticky labels aligned on both axes, while
          the controls above take their natural height even when they wrap. */}
      <div className="workspace-board w-full min-h-0 overflow-x-auto overflow-y-auto scroll-pt-14 px-4 sm:px-6 lg:px-8 pb-6 flex-1" role="region" aria-label="Task board" aria-busy={initialLoading || !user} tabIndex={0}>
        {initialLoading || !user ? (
          <div role="status" className="py-12 text-center text-ink-soft">Loading streams and cards…</div>
        ) : loadFailed && streams.length === 0 ? (
          <div className="py-12 text-center text-ink-soft">
            <p role="status">Could not load your workspace.</p>
            <button type="button" className="btn btn-secondary mt-3 min-h-11" onClick={() => { setInitialLoading(true); void loadData(user.id); }}>Try again</button>
          </div>
        ) : <StreamOrdering
          streams={filteredStreams} disabled={streamOrder.disabled} onMove={streamOrder.move}
          horizontal={!mobileViewport && layout === 'stream'}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          {compact && filteredStreams.length > 0 ? <MobileCards enableStatusDrop={statusDragEnabled} dragging={!!activeDragCard} historyLimit={historyLimit} view={view} layout={layout as 'status' | 'stream'} streams={filteredStreams} columns={columns} cardsForStream={getCardsForStream} renderCard={renderCard} onAdd={setCreationContext} onEditStream={setEditingStream} /> :
          <div className={`space-y-3 mx-auto ${mobileViewport ? 'mobile-matrix' : ''}`} style={{ maxWidth: matrixMaxWidth, minWidth: compact ? 0 : mobileViewport ? 34 + columns.length * 240 + (columns.length - 1) * GRID_GAP : 34 + streamColWidth + columns.length * 180 + columns.length * GRID_GAP }}>
            {!compact && <div
              className="sticky top-0 z-20 grid gap-3 items-center px-4 py-2 bg-canvas border border-transparent border-b-line shadow-sm"
              data-status-headers
              style={{ gridTemplateColumns: mobileViewport ? `repeat(${columns.length}, minmax(240px, 1fr))` : gridColumns }}
            >
              <Link href="/streams" aria-label="View all streams" className="font-medium text-sm px-3 min-h-11 flex items-center gap-2 rounded text-ink-soft hover:text-ink hover:underline focus-ring">
                Stream <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
              {columns.map((status) => (
                <div key={status} className="status-column">
                  <StatusHeader status={status} />
                </div>
              ))}
            </div>}

            {filteredStreams.length > 0 ? (
              filteredStreams.map((stream) => {
                const streamCards = getCardsForStream(stream.id);

                return (
                  <SortableStreamRow
                    key={stream.id} stream={stream}
                    className={`stream-row rounded-xl p-4 ${stream.title === 'Uncategorized' ? 'uncategorized' : ''}`}
                  >
                    <div 
                      className="grid gap-3"
                      style={{ gridTemplateColumns: mobileViewport ? `repeat(${columns.length}, minmax(240px, 1fr))` : gridColumns }}
                    >
                      <StreamTitle stream={stream} onEdit={() => setEditingStream(stream)} />

                      {columns.map((status) => {
                        const cellCards = streamCards.filter((c) => c.status === status);
                        const cellId = `${stream.id}::${status}`;

                        return (
                          <div key={status} className="status-column h-full">
                            <DroppableCell id={cellId} isEmpty={cellCards.length === 0}
                              onAdd={stream.state === 'in_progress' ? () => setCreationContext({ streamId: stream.id, status }) : undefined}
                              addLabel={`Add card to ${stream.title} — ${STATUS_LABELS[status]}.`}>
                              <div className="space-y-2">
                                {status === 'complete' || status === 'canceled'
                                  ? <ArchiveCards key={`${stream.id}:${status}:${historyLimit}`} limit={historyLimit} cards={cellCards} status={status} renderCard={renderCard} />
                                  : cellCards.map(renderCard)}
                              </div>
                            </DroppableCell>
                          </div>
                        );
                      })}
                    </div>
                  </SortableStreamRow>
                );
              })
            ) : (
              <div className="text-center py-12 text-ink-soft">
                {hideRecurring ? (
                  <>
                    <p>No non-recurring tasks in this view.</p>
                    <button
                      type="button"
                      className="btn btn-secondary mt-3 min-h-11"
                      onClick={() => { setHideRecurring(false); savePreferences({ hideRecurring: false }); }}
                    >
                      Show recurring
                    </button>
                  </>
                ) : 'No streams with cards in this view.'}
              </div>
            )}
          </div>}

          <DragOverlay dropAnimation={null}>
            {activeDragCard ? (
              <div className="w-64 max-w-full">
                <CardComponent card={activeDragCard} prerequisite={cards.find(other => other.id === activeDragCard.prerequisite_card_id)} overlay touchMode={touchMode} desktop={!mobileViewport} />
              </div>
            ) : null}
          </DragOverlay>
        </StreamOrdering>}

        {creationContext && (
          <AddCardModal
            streams={streams}
            cards={cards}
            defaultStreamId={creationContext.streamId}
            defaultStatus={creationContext.status}
            onClose={() => setCreationContext(null)}
            onCardCreated={handleCardCreated}
          />
        )}

        {movingCard && <MoveCardModal card={movingCard} streams={streams} onClose={() => setMovingCard(null)} onMove={async (streamId, status) => {
          if (!user || !accountActive.current) return;
          const position = Math.max(-1, ...cards.filter(card => card.id !== movingCard.id && card.stream_id === streamId && card.status === status).map(card => card.position || 0)) + 1;
          const result = await saveQuickAction(movingCard, { stream_id: streamId, status, position });
          if (!accountActive.current) return;
          await loadData(user.id, false);
          showUndoToast('Card moved', result.undo_id);
        }} />}

        {editingCard && (
          <EditCardModal
            card={editingCard}
            cards={cards}
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
