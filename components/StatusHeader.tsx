import { STATUS_LABELS, CardStatus } from '@/lib/types';

interface StatusHeaderProps {
  status: CardStatus | string;
}

export function StatusHeader({ status }: StatusHeaderProps) {
  const label = STATUS_LABELS[status as CardStatus] || status;

  return (
    <div className="px-3 py-2 text-xs font-medium tracking-wider uppercase text-zinc-500 dark:text-zinc-400">
      {label}
    </div>
  );
}
