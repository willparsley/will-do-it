'use client';

import { Card as CardType } from '@/lib/types';
import { Check, Repeat } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';

interface CardViewProps {
  card: CardType;
  onClick?: () => void;
  onComplete?: (id: string) => void;
}

/**
 * Presentational card. Used both for the real, draggable card and for the
 * DragOverlay preview (so the preview doesn't register a duplicate draggable).
 */
export function CardView({ card, onClick, onComplete }: CardViewProps) {
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

  return (
    <div
      onClick={onClick}
      className={`card rounded-lg p-3 text-sm cursor-grab active:cursor-grabbing group ${
        isPriority ? 'card-priority pl-4' : ''
      }`}
    >
      <div className="font-medium leading-tight flex items-start justify-between gap-2 text-ink min-w-0">
        <span className="break-words min-w-0">{card.title}</span>
        {card.is_recurring && (
          <Repeat className="h-3 w-3 flex-shrink-0 text-ink-muted mt-0.5" />
        )}
        {onComplete && card.status !== 'complete' && card.status !== 'canceled' && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleComplete}
            className="opacity-0 group-hover:opacity-100 hover:opacity-80 p-0.5 transition-opacity"
            style={{ color: 'var(--status-complete)' }}
            title="Mark complete"
          >
            <Check className="h-3 w-3" />
          </button>
        )}
      </div>

      {card.is_recurring && card.last_completed_at && (
        <div className="text-[10px] text-ink-muted mt-1">
          Last done {new Date(card.last_completed_at).toLocaleDateString()}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
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

export function Card({ card, onClick, onComplete, overlay = false }: CardProps) {
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
      <CardView card={card} onClick={onClick} onComplete={onComplete} />
    </div>
  );
}
