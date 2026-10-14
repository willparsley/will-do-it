'use client';

import { Area } from '@/lib/types';

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
    <div className="flex items-center gap-0.5 text-sm border border-line rounded-full p-0.5 bg-surface">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-full transition-colors text-xs font-medium ${
            value === opt.value
              ? 'bg-accent text-accent-ink'
              : 'text-ink-soft hover:text-ink hover:bg-sunken'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
