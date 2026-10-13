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
    <div className="flex items-center gap-1 text-sm border border-zinc-200 dark:border-zinc-800 rounded-full p-0.5">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-full transition-all text-xs font-medium ${
            value === opt.value 
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-950' 
              : 'text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:text-zinc-400'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
