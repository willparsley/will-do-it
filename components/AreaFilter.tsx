'use client';

import { Area } from '@/lib/types';
import { AreaIndicator } from './AreaIndicator';
import styles from './StreamArea.module.css';
import { TooltipButton } from './TooltipButton';

interface AreaFilterProps {
  value: Area | 'all';
  onChange: (value: Area | 'all') => void;
}

export function AreaFilter({ value, onChange }: AreaFilterProps) {
  const options: { label: string; value: Area | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Work', value: 'work' },
    { label: 'Personal', value: 'personal' },
  ];

  return (
    <div role="group" aria-label="Area filter" className="flex items-center gap-0.5 text-sm border border-line rounded-full p-0.5 bg-surface">
      {options.map(opt => (
        <TooltipButton
          tooltip={opt.value === 'all' ? 'Show streams from all areas' : `Show ${opt.label.toLowerCase()} streams`}
          key={opt.value}
          onPress={() => onChange(opt.value)}
          type="button"
          data-area={opt.value}
          aria-pressed={value === opt.value}
          className={`${styles.area} ${styles.filter} focus-ring`}
        >
          {opt.value !== 'all' && opt.value !== 'neutral' && <AreaIndicator area={opt.value} />}
          {opt.label}
        </TooltipButton>
      ))}
    </div>
  );
}
