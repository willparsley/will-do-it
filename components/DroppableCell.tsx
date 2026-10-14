'use client';

import React from 'react';
import { useDroppable, useDndContext } from '@dnd-kit/core';

interface DroppableCellProps {
  id: string;
  children: React.ReactNode;
  className?: string;
  /** Show the "Drop here" hint when this empty cell is the active drop target during a drag. */
  isEmpty?: boolean;
}

export function DroppableCell({ id, children, className = '', isEmpty = false }: DroppableCellProps) {
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
      className={`min-h-[110px] h-full rounded-lg p-2 border transition-colors ${stateClasses} ${className}`}
      style={isOver ? { borderStyle: 'dashed' } : undefined}
    >
      {isEmpty && isDragging && isOver && (
        <div className="text-[10px] text-ink-muted h-8 flex items-center justify-center">
          Drop here
        </div>
      )}
      {children}
    </div>
  );
}
