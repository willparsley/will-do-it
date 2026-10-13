'use client';

import { Card as CardType } from '@/lib/types';

interface CardProps {
  card: CardType;
  onClick?: () => void;
}

export function Card({ card, onClick }: CardProps) {
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

  return (
    <div 
      onClick={onClick}
      className="card rounded-lg p-3 text-sm shadow-sm cursor-grab active:cursor-grabbing border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
    >
      <div className="font-medium leading-tight flex items-start justify-between gap-2">
        <span>{card.title}</span>
        {card.is_recurring && <span className="text-emerald-500 text-xs flex-shrink-0">↻</span>}
      </div>

      {card.is_recurring && card.last_completed_at && (
        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
          Last done {new Date(card.last_completed_at).toLocaleDateString()}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {hasReminder && <span title="Has reminder" className="text-amber-500">🔔</span>}
        {dueBadge}
      </div>
    </div>
  );
}
