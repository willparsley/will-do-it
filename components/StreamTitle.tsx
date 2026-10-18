'use client';

import { Pencil } from 'lucide-react';
import type { Stream } from '@/lib/types';
import { AreaIndicator } from './AreaIndicator';
import styles from './StreamArea.module.css';

export function StreamTitle({ stream, onEdit }: { stream: Stream; onEdit: () => void }) {
  return <div className={`${styles.area} ${styles.titleCell}`} data-area={stream.area}>
    <div className={styles.heading}>
      {stream.area !== 'neutral' && <AreaIndicator area={stream.area} labelled />}
      <div className="min-w-0 flex-1">
        {stream.title === 'Uncategorized'
          ? <span className="font-medium break-words">{stream.title}</span>
          : <button type="button" className={`${styles.edit} focus-ring`} aria-label={`Edit stream ${stream.title}`}
            onClick={event => { event.currentTarget.focus(); onEdit(); }}>
            <span className="min-w-0 break-words">{stream.title}</span>
            <Pencil size={14} className={styles.pencil} aria-hidden="true" />
          </button>}
        {stream.state !== 'in_progress' && <span className="mt-2 inline-block text-[10px] px-1.5 py-px rounded bg-sunken text-ink-soft">
          {stream.state === 'complete' ? 'Complete' : 'Canceled'}
        </span>}
      </div>
    </div>
  </div>;
}
