'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface DroppableCellProps {
  id: string;
  children: React.ReactNode;
}

export function DroppableCell({ id, children }: DroppableCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[110px] rounded-lg p-2 border transition-colors ${
        isOver 
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30' 
          : 'border-dashed border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
      }`}
    >
      {children}
    </div>
  );
}
