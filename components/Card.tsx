'use client';

import { Card as CardType, nextStatus, STATUS_LABELS } from '@/lib/types';
import { ArrowRight, Check, Repeat } from 'lucide-react';
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
  const isPriority = card.status === 'priority_backlog';

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
  const showActions = !isFinished && (onComplete || (onAdvance && next));

  const handleAdvance = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAdvance) onAdvance(card.id);
  };

  return (
    <div
      onClick={onClick}
      className={`card rounded-lg p-3 text-sm cursor-grab active:cursor-grabbing group relative ${
        isPriority ? 'card-priority pl-4' : ''
      }`}
    >
      <div className={`font-medium leading-tight flex items-start justify-between gap-2 text-ink min-w-0 ${showActions ? 'pr-8' : ''}`}>
        <span className={`break-words min-w-0 ${showActions ? 'pr-6' : ''}`}>{card.title}</span>
        {card.is_recurring && (
          <Repeat className="h-3 w-3 flex-shrink-0 text-ink-muted mt-0.5" />
        )}
      </div>

      {showActions && (
        <div className="absolute top-0 right-0 bottom-0 z-10 w-8 flex flex-col">
          {/* Complete tab - upper, dark bg + green icon, visible on hover */}
          <div className="flex-[49] flex items-end justify-end">
            {onComplete && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleComplete}
                className="opacity-0 group-hover:opacity-100 w-full min-h-[20px] h-[70%] rounded-r-lg flex items-center justify-center transition-all hover:shadow-[inset_0_3px_5px_rgba(0,0,0,0.5)]"
                style={{ backgroundColor: '#285748', color: '#00C177' }}
                title="Mark complete"
              >
                <Check className="h-5 w-5" />
              </button>
            )}
          </div>
          {/* Fixed small gap */}
          <div className="h-[3px] flex-shrink-0" />
          {/* Promote tab - lower, bg = next status color, icon contrasting (white for visibility) */}
          <div className="flex-[49] flex items-start justify-end">
            {onAdvance && next && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleAdvance}
                className="opacity-0 group-hover:opacity-100 w-full min-h-[20px] h-[70%] rounded-r-lg flex items-center justify-center transition-all hover:shadow-[inset_0_3px_5px_rgba(0,0,0,0.5)]"
                style={{ backgroundColor: `var(--status-${next})`, color: 'white' }}
                title={`Advance to ${STATUS_LABELS[next]}`}
              >
                <ArrowRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {card.is_recurring && card.last_completed_at && (
        <div className={`text-[10px] text-ink-muted mt-1 ${showActions ? 'pr-8' : ''}`}>
          Last done {new Date(card.last_completed_at).toLocaleDateString()}
        </div>
      )}

      <div className={`mt-2 flex items-center gap-2 flex-wrap text-xs ${showActions ? 'pr-8' : ''}`}>
        {hasReminder && (
          <span title="Has reminder" style={{ color: 'var(--status-priority_backlog)' }}>
            🔔
          </span>
        )}
        {dueBadge}
      </div>
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
