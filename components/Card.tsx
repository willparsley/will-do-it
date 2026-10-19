'use client';

import { Card as CardType, nextStatus, STATUS_LABELS } from '@/lib/types';
import { isCardBlocked } from '@/lib/card-prerequisites';
import { Pencil, Check, ArrowRight, Repeat, LockKeyhole, MoveRight } from 'lucide-react';
import { dueBadge, isTerminal } from '@/lib/card-views';
import { useDraggable } from '@dnd-kit/core';

interface CardViewProps {
  card: CardType;
  prerequisite?: CardType;
  onClick?: (event: React.MouseEvent) => void;
  onEdit?: () => void;
  onMove?: () => void;
  compact?: boolean;
  context?: React.ReactNode;
  selected?: boolean;
  touchMode?: boolean;
  onComplete?: (id: string) => void;
  onAdvance?: (id: string) => void;
  onEditRecurrence?: (sourceId: string) => void;
}

/**
 * Presentational card. Used both for the real, draggable card and for the
 * DragOverlay preview (so the preview doesn't register a duplicate draggable).
 */
export function CardView({ card, prerequisite, onClick, onComplete, onAdvance, onEditRecurrence, onEdit, selected = false, touchMode = false, compact = false, context, onMove }: CardViewProps) {
  const blocked = isCardBlocked(card, prerequisite);
  const isFinished = isTerminal(card);
  const hasReminder = !isFinished && !!card.remind_at;
  const badge = dueBadge(card);

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onComplete) onComplete(card.id);
  };

  const next = nextStatus(card.status);
  const isComplete = card.status === 'complete';
  const canComplete = !!onComplete;
  const canPromote = !!(onAdvance && next);
  const showActions = !isFinished && (canComplete || canPromote);
  const promoteColor = next ? `var(--card-action-${next}, var(--status-${next}))` : undefined;
  const hasStatusBar = !isFinished;

  const handleAdvance = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAdvance) onAdvance(card.id);
  };

  return (
    <div
      onClick={onClick}
      data-card-id={card.id}
      data-selected={selected || undefined}
      data-compact={compact || undefined}
      className={`card rounded-lg text-sm cursor-grab active:cursor-grabbing group grid ${(touchMode || selected) && !isFinished ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_2.25rem]'} overflow-hidden ${hasStatusBar ? 'status-bar' : ''} ${blocked ? 'card-blocked' : ''}`}
      style={hasStatusBar ? ({ '--status-color': `var(--status-${card.status})` } as React.CSSProperties) : undefined}
    >
      {/* Left content */}
      <div className={compact ? "px-3 py-2.5" : "p-3"}>
        {context && <div className="mb-1 text-xs text-ink-soft">{context}</div>}
        <div className="card-title font-medium leading-tight text-ink min-w-0">
          {onClick ? <button type="button" className="block w-full text-left break-words min-w-0 focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={`Actions for ${card.title}`} aria-expanded={selected}>{card.title}</button>
            : <span className="break-words min-w-0">{card.title}</span>}
        </div>

        {blocked && <p className="card-blocked-label mt-2 flex items-start gap-1 text-xs">
          <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words min-w-0">Blocked by: {prerequisite?.title || 'unavailable prerequisite'}</span>
        </p>}

        {!isFinished && (!compact || selected) && card.is_recurring && card.last_completed_at && (
          <div className="card-metadata text-ink-muted mt-1">
            Last completed on {new Date(card.last_completed_at).toLocaleDateString(undefined, { timeZone: card.recurrence_timezone })}
          </div>
        )}

        {isFinished && card.completed_at && (
          <div className="card-metadata text-ink-muted mt-1">
            {isComplete ? 'Completed' : 'Canceled'} {new Date(card.completed_at).toLocaleDateString()}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
          {badge && <span className={`badge badge-${badge.kind}`}>{badge.label}</span>}
          {card.is_recurring && (
            card.recurrence_source_id && onEditRecurrence && !compact ? (
              <button type="button" aria-label="Edit recurrence" title="Edit recurrence"
                className="inline-flex items-center justify-center rounded p-1 -m-1 text-ink-soft hover:text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
                onPointerDown={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                onTouchStart={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onEditRecurrence(card.recurrence_source_id!); }}>
                <Repeat className="h-3 w-3 flex-shrink-0" />
              </button>
            ) : <Repeat className="h-3 w-3 flex-shrink-0 text-ink-muted" />
          )}
          {hasReminder && (
            <span title="Has reminder" style={{ color: 'var(--status-priority_backlog)' }}>
              🔔
            </span>
          )}
        </div>
      </div>

      {/* Right column: action rail for active cards, or static visual flair for finished cards */}
      {showActions && !touchMode && !selected && (
        <div className="grid grid-rows-[repeat(2,minmax(0,1fr))] w-9 self-stretch">
          {/* Upper row cell (complete tab) */}
          <div className="h-full w-full">
            {canComplete && (
              <button
                onClick={handleComplete}
                onPointerDown={(e) => e.stopPropagation()}
                className="h-full w-full flex items-center justify-center bg-[#285748] hover:bg-[#1e2f38] transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto hover:shadow-[inset_0_3px_5px_rgba(0,0,0,0.45)]"
                type="button" aria-label="Mark complete" title="Mark complete"
              >
                <svg
                  className="h-6 w-6 text-[#00C177]"
                  viewBox="308 12 46 52"
                  fill="currentColor"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <path d="M325.295,53.446c2.325-5.749,4.523-11.085,7.086-16.265 c3.067-6.204,6.608-12.116,10.556-17.796c1.163-1.673,2.563-2.852,4.674-3.027c0.751-0.062,1.545-0.239,2.05,0.461 c0.604,0.837,0.031,1.565-0.446,2.217c-2.943,4.013-5.751,8.114-8.287,12.399c-4.778,8.077-8.718,16.541-11.774,25.413 c-0.52,1.509-0.967,2.954-2.949,3.152c-1.986,0.199-3.157-0.639-4.095-2.339c-2.381-4.319-5.537-8.056-8.956-11.598 c-0.862-0.893-2.523-1.876-1.11-3.514c1.164-1.348,3.514-1.201,4.976,0.178C320.226,45.752,322.562,49.467,325.295,53.446z" />
                </svg>
              </button>
            )}
          </div>

          {/* Lower row cell (promote tab) */}
          <div className="h-full w-full">
            {canPromote && (
              <button
                onClick={handleAdvance}
                onPointerDown={(e) => e.stopPropagation()}
                className="h-full w-full flex items-center justify-center hover:brightness-[0.72] transition-all opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto hover:shadow-[inset_0_3px_5px_rgba(0,0,0,0.45)]"
                style={{ backgroundColor: promoteColor }}
                type="button" aria-label={`Advance to ${next ? STATUS_LABELS[next] : ''}`} title={`Advance to ${next ? STATUS_LABELS[next] : ''}`}
              >
                <svg
                  className="h-6 w-6 group-hover:brightness-[1.4]"
                  viewBox="300 87 62 46"
                  fill="currentColor"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ color: `color-mix(in srgb, ${promoteColor} 55%, black)` }}
                >
                  <path d="M337.76,102.48c0.14-0.27,0.09-0.512,0.09-0.744 c0.004-3.43,0.003-6.858,0.003-10.287c0-0.193,0.004-0.389,0.002-0.582c-0.005-0.439,0.113-0.814,0.554-1.005 c0.445-0.192,0.81-0.007,1.115,0.292c0.832,0.813,16.838,16.805,18.977,18.965c0.87,0.879,0.858,1.221-0.017,2.098 c-6.264,6.27-12.53,12.534-18.797,18.799c-0.344,0.344-0.713,0.666-1.251,0.453c-0.572-0.227-0.586-0.73-0.585-1.244 c0.005-3.58,0.004-7.16,0.002-10.74c0-0.277,0.039-0.561-0.106-0.9c-0.967-0.293-2.01-0.43-3.049-0.574 c-7.589-1.055-14.792,0.398-21.77,3.341c-3.104,1.309-6.113,2.804-9.056,4.437c-0.485,0.269-0.953,0.355-1.356-0.076 c-0.384-0.412-0.276-0.873,0.011-1.307c0.059-0.091,0.116-0.182,0.175-0.272c1.858-2.843,3.986-5.468,6.403-7.855 c4.515-4.459,9.616-8.042,15.564-10.339c3.979-1.537,8.096-2.383,12.374-2.37c0.173,0.001,0.346-0.005,0.517-0.018 C337.622,102.545,337.679,102.51,337.76,102.48z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Finished card visual flair (full-height right column) */}
      {isFinished && (
        <div
          className={`w-9 self-stretch flex items-center justify-center rounded-r-lg ${
            isComplete ? 'bg-[#285748]' : 'card-canceled-rail'
          }`}
        >
          {isComplete ? (
            <svg
              className="h-8 w-8 text-[#00C177]"
              viewBox="308 12 46 52"
              fill="currentColor"
              preserveAspectRatio="xMidYMid meet"
            >
              <path d="M325.295,53.446c2.325-5.749,4.523-11.085,7.086-16.265 c3.067-6.204,6.608-12.116,10.556-17.796c1.163-1.673,2.563-2.852,4.674-3.027c0.751-0.062,1.545-0.239,2.05,0.461 c0.604,0.837,0.031,1.565-0.446,2.217c-2.943,4.013-5.751,8.114-8.287,12.399c-4.778,8.077-8.718,16.541-11.774,25.413 c-0.52,1.509-0.967,2.954-2.949,3.152c-1.986,0.199-3.157-0.639-4.095-2.339c-2.381-4.319-5.537-8.056-8.956-11.598 c-0.862-0.893-2.523-1.876-1.11-3.514c1.164-1.348,3.514-1.201,4.976,0.178C320.226,45.752,322.562,49.467,325.295,53.446z" />
            </svg>
          ) : (
            <svg
              className="h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          )}
        </div>
      )}

      {selected && onClick && <div className="col-span-full flex border-t border-line bg-surface" role="group" aria-label={`Actions for ${card.title}`}
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <button type="button" className="card-touch-action text-ink-soft" aria-label={`Edit ${card.title}`} onClick={onEdit}>
          <Pencil size={16} aria-hidden="true" /><span>Edit</span>
        </button>
        {onMove && <button type="button" className="card-touch-action text-ink-soft" onClick={onMove}><MoveRight size={16} aria-hidden="true" /><span>Move</span></button>}
        {!isFinished && canComplete && <button type="button" className="card-touch-action card-touch-complete" aria-label="Mark complete" onClick={handleComplete}>
          <Check size={16} aria-hidden="true" /><span>Complete</span>
        </button>}
        {!isFinished && canPromote && <button type="button" className="card-touch-action" style={{ color: `color-mix(in srgb, var(--status-${next}) 55%, var(--text))` }} aria-label={`Advance to ${next ? STATUS_LABELS[next] : ''}`} onClick={handleAdvance}>
          <ArrowRight size={16} aria-hidden="true" /><span>Advance</span>
        </button>}
      </div>}
    </div>
  );
}

interface CardProps extends CardViewProps {
  /** Rendered inside a DragOverlay — not interactive, not draggable. */
  overlay?: boolean;
}

export function Card({ card, prerequisite, onClick, onComplete, onAdvance, onEditRecurrence, onEdit, selected, touchMode, compact, context, onMove, overlay = false }: CardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: overlay || compact,
  });

  if (overlay) {
    return (
      <div className="rotate-1 scale-[1.03] shadow-lg">
        <CardView card={card} prerequisite={prerequisite} touchMode={touchMode} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...(compact ? {} : attributes)}
      {...(compact ? {} : listeners)}
      role={undefined}
      tabIndex={undefined}
      className={isDragging ? 'opacity-40' : ''}
    >
      <CardView card={card} prerequisite={prerequisite} onClick={onClick} onComplete={onComplete} onAdvance={onAdvance} onEditRecurrence={onEditRecurrence} selected={selected} touchMode={touchMode} onEdit={onEdit} compact={compact} context={context} onMove={onMove} />
    </div>
  );
}
