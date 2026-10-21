'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DndContext, MouseSensor, TouchSensor, KeyboardSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type DndContextProps, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RotateCcw } from 'lucide-react';
import styles from './StreamOrdering.module.css';
import type { Stream } from '@/lib/types';

// Card keyboard events retain their existing selection/edit behavior.
class StreamKeyboardSensor extends KeyboardSensor {
  static activators: typeof KeyboardSensor.activators = KeyboardSensor.activators.map(activator => ({
    ...activator,
    handler: (event, options, context) => context.active.data.current?.kind === 'stream'
      && activator.handler(event, options, context),
  }));
}

const streamKey = (id: string) => `stream:${id}`;
const Handle = createContext<Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setActivatorNodeRef'> | null>(null);
const Disabled = createContext(false);

/** A single drag context routes stream backgrounds and cards to separate targets. */
export function StreamOrdering({ streams, disabled, onMove, children, onDragStart, onDragEnd, onDragCancel }: {
  streams: Stream[]; disabled: boolean; children: ReactNode;
  onMove: (id: string, target: string, after: boolean) => void;
} & Pick<DndContextProps, 'onDragStart' | 'onDragEnd' | 'onDragCancel'>) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(StreamKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const items = streams.filter(s => s.title !== 'Uncategorized').map(s => streamKey(s.id));
  const end = (event: DragEndEvent) => {
    if (event.active.data.current?.kind !== 'stream') { onDragEnd?.(event); return; }
    onDragCancel?.(event);
    const moved = event.active.data.current.streamId as string;
    const target = event.over?.data.current?.streamId as string | undefined;
    if (!disabled && target && target !== moved) {
      onMove(moved, target, items.indexOf(streamKey(moved)) < items.indexOf(streamKey(target)));
    }
  };
  return <Disabled.Provider value={disabled}>
    <DndContext sensors={sensors}
      accessibility={{ screenReaderInstructions: { draggable: 'Press Space to pick up a stream. Use Up and Down to reorder it, Space to drop, or Escape to cancel.' } }}
      collisionDetection={args => {
        const streamDrag = args.active.data.current?.kind === 'stream';
        const droppableContainers = args.droppableContainers.filter(item =>
          streamDrag ? item.data.current?.kind === 'stream' : item.data.current?.kind !== 'stream');
        return (streamDrag && !args.pointerCoordinates ? closestCenter : pointerWithin)({ ...args, droppableContainers });
      }}
      onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={end}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    </DndContext>
  </Disabled.Provider>;
}

export function SortableStreamRow({ stream, children, className, as: Element = 'div' }: {
  stream: Stream; children: ReactNode; className?: string; as?: 'div' | 'li';
}) {
  const disabled = useContext(Disabled);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: streamKey(stream.id), data: { kind: 'stream', streamId: stream.id },
    disabled: disabled || stream.title === 'Uncategorized' });
  return <Handle.Provider value={{ setActivatorNodeRef, attributes, listeners }}>
    <Element ref={setNodeRef} className={className} data-stream-id={stream.id}
      style={{ transform: CSS.Transform.toString(transform), transition,
        position: 'relative', zIndex: isDragging ? 30 : undefined, opacity: isDragging ? 0.7 : undefined }}>
      {children}
    </Element>
  </Handle.Provider>;
}

/** The background button occupies no layout space. Text/actions remain above it. */
export function StreamDragSurface({ stream, children, className, contentClassName, area }: {
  stream: Stream; children: ReactNode; className?: string; contentClassName?: string; area?: Stream['area'];
}) {
  const sortable = useContext(Handle);
  const disabled = useContext(Disabled);
  const movable = !!sortable && stream.title !== 'Uncategorized';
  const { setActivatorNodeRef, attributes, listeners } = sortable || {};
  return <div className={`${styles.surface} ${className || ''}`} data-area={area}>
    {movable && <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners}
      aria-label={`Reorder stream ${stream.title}`} aria-disabled={disabled}
      className={`${styles.drag} focus-ring`}
      onClick={event => { event.preventDefault(); event.stopPropagation(); }} />}
    <div className={`${movable ? styles.content : ''} ${contentClassName || ''}`}>{children}</div>
  </div>;
}

export function StreamOrderReset({ custom, disabled, onReset }: { custom: boolean; disabled: boolean; onReset: () => void }) {
  if (!custom) return null;
  return <button type="button" className="btn btn-secondary focus-ring min-h-11 w-full sm:w-auto px-4 py-2 text-sm shadow-sm mb-6" disabled={disabled} onClick={onReset}>
    <RotateCcw size={16} className="shrink-0" aria-hidden="true" />
    Reset stream order to alphabetical
  </button>;
}
