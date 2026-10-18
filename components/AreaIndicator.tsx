import { BriefcaseBusiness, House } from 'lucide-react';
import type { Area } from '@/lib/types';
import styles from './StreamArea.module.css';

export function AreaIndicator({ area, labelled = false }: { area: Exclude<Area, 'neutral'>; labelled?: boolean }) {
  const label = area === 'work' ? 'Work' : 'Personal';
  const Icon = area === 'work' ? BriefcaseBusiness : House;
  return <span className={styles.icon} title={label} role={labelled ? 'img' : undefined}
    aria-label={labelled ? label : undefined} aria-hidden={labelled ? undefined : true}>
    <Icon size={16} aria-hidden="true" />
  </span>;
}
