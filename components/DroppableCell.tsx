'use client';

import React from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import styles from './DroppableCell.module.css';

interface DroppableCellProps {
  id: string;
  children: React.ReactNode;
  className?: string;
  /** Show the "Drop here" hint when this empty cell is the active drop target during a drag. */
  isEmpty?: boolean;
  onAdd?: () => void;
  addLabel?: string;
}

export function DroppableCell({ id, children, className = '', isEmpty = false, onAdd, addLabel }: DroppableCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const { active } = useDndContext();
  const isDragging = !!active;

  // Only react to hovering while a card is actually being dragged.
  const stateClasses = isOver
    ? 'border-accent bg-accent-soft'
    : isDragging
      ? 'border-transparent hover:border-line'
      : 'border-transparent';

  return (
    <div
      ref={setNodeRef}
      className={`${styles.cell} min-h-[110px] h-full rounded-lg p-2 border transition-colors ${stateClasses} ${className}`}
      data-dragging={isDragging || undefined}
      style={isOver ? { borderStyle: 'dashed' } : undefined}
    >
      {isEmpty && isDragging && isOver && (
        <div className="text-[10px] text-ink-muted h-8 flex items-center justify-center">
          Drop here
        </div>
      )}
      {children}
      {onAdd && (
        <button
          type="button"
          className={styles.add}
          aria-label={addLabel}
          title={addLabel}
          disabled={isDragging}
          onClick={event => {
            // Also establish the restore target on browsers that don't focus clicks.
            event.currentTarget.focus();
            onAdd();
          }}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
