'use client';

import { Card as CardType, nextStatus, STATUS_LABELS } from '@/lib/types';
import { Check, Repeat } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';

interface CardViewProps {
  card: CardType;
  onClick?: () => void;
  onComplete?: (id: string) => void;
  onAdvance?: (id: string) => void;
}

/**
 * Presentational card. Used both for the real, draggable card and for the
 * DragOverlay preview (so the preview doesn't register a duplicate draggable).
 */
export function CardView({ card, onClick, onComplete, onAdvance }: CardViewProps) {
  const hasReminder = !!card.remind_at;
  const dueDate = card.due_at ? new Date(card.due_at) : null;
  const isOverdue = dueDate && dueDate < new Date();
  const isToday = dueDate && dueDate.toDateString() === new Date().toDateString();

  let dueBadge = null;
  if (dueDate) {
    if (isOverdue) {
      dueBadge = <span className="badge badge-overdue">Overdue</span>;
    } else if (isToday) {
      dueBadge = <span className="badge badge-today">Today</span>;
    } else {
      dueBadge = <span className="badge badge-future">{dueDate.toLocaleDateString()}</span>;
    }
  }

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onComplete) onComplete(card.id);
  };

  const next = nextStatus(card.status);
  const isFinished = card.status === 'complete' || card.status === 'canceled';
  const isComplete = card.status === 'complete';
  const canComplete = !!onComplete;
  const canPromote = !!(onAdvance && next);
  const showActions = !isFinished && (canComplete || canPromote);
  const promoteColor = next ? `var(--status-${next})` : undefined;
  const hasStatusBar = !isFinished;

  const handleAdvance = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAdvance) onAdvance(card.id);
  };

  return (
    <div
      onClick={onClick}
      className={`card rounded-lg text-sm cursor-grab active:cursor-grabbing group grid grid-cols-[minmax(0,1fr)_2.25rem] overflow-hidden ${
        hasStatusBar ? 'status-bar' : ''
      }`}
      style={hasStatusBar ? ({ '--status-color': `var(--status-${card.status})` } as React.CSSProperties) : undefined}
    >
      {/* Left content */}
      <div className="p-3">
        <div className="font-medium leading-tight text-ink min-w-0">
          <span className="break-words min-w-0">{card.title}</span>
        </div>

        {card.is_recurring && card.last_completed_at && (
          <div className="text-[10px] text-ink-muted mt-1">
            Last done {new Date(card.last_completed_at).toLocaleDateString()}
          </div>
        )}

        <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
          {dueBadge}
          {card.is_recurring && (
            <Repeat className="h-3 w-3 flex-shrink-0 text-ink-muted" />
          )}
          {hasReminder && (
            <span title="Has reminder" style={{ color: 'var(--status-priority_backlog)' }}>
              🔔
            </span>
          )}
        </div>
      </div>

      {/* Right column: action rail for active cards, or static visual flair for finished cards */}
      {showActions && (
        <div className="grid grid-rows-[repeat(2,minmax(0,1fr))] w-9 self-stretch">
          {/* Upper row cell (complete tab) */}
          <div className="h-full w-full">
            {canComplete && (
              <button
                onClick={handleComplete}
                onPointerDown={(e) => e.stopPropagation()}
                className="h-full w-full flex items-center justify-center bg-[#285748] hover:bg-[#1e2f38] transition-all opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto hover:shadow-[inset_0_3px_5px_rgba(0,0,0,0.45)]"
                title="Mark complete"
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
                className="h-full w-full flex items-center justify-center hover:brightness-[0.72] transition-all opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto hover:shadow-[inset_0_3px_5px_rgba(0,0,0,0.45)]"
                style={{ backgroundColor: promoteColor }}
                title={`Advance to ${next ? STATUS_LABELS[next] : ''}`}
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
            isComplete ? 'bg-[#285748]' : 'bg-[#7f1d1d]'
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
              className="h-8 w-8 text-[#f87171]"
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
    </div>
  );
}

interface CardProps extends CardViewProps {
  /** Rendered inside a DragOverlay — not interactive, not draggable. */
  overlay?: boolean;
}

export function Card({ card, onClick, onComplete, onAdvance, overlay = false }: CardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: overlay,
  });

  if (overlay) {
    return (
      <div className="rotate-1 scale-[1.03] shadow-lg">
        <CardView card={card} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-40' : ''}
    >
      <CardView card={card} onClick={onClick} onComplete={onComplete} onAdvance={onAdvance} />
    </div>
  );
}
