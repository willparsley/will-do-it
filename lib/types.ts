export type StreamState = 'in_progress' | 'complete' | 'canceled';
export type CardStatus =
  | 'backlog'
  | 'priority_backlog'
  | 'research'
  | 'waiting'
  | 'in_progress'
  | 'review'
  | 'complete'
  | 'canceled';

export type Area = 'work' | 'personal' | 'neutral';

/** Title of the system-managed stream. Always pinned to the bottom of lists. */
export const UNCATEGORIZED_TITLE = 'Uncategorized';

export interface Stream {
  id: string;
  user_id: string;
  title: string;
  state: StreamState;
  area: Area;
  notes?: string;
  position: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Streams to offer in card-modals' stream dropdowns: only active streams
 * (completed/canceled are hidden), sorted alphabetically, with
 * "Uncategorized" always last.
 */
export function streamsForSelect(streams: Stream[]): Stream[] {
  return streams
    .filter((s) => s.state === 'in_progress')
    .sort((a, b) => {
      const aUnc = a.title === UNCATEGORIZED_TITLE ? 1 : 0;
      const bUnc = b.title === UNCATEGORIZED_TITLE ? 1 : 0;
      if (aUnc !== bUnc) return aUnc - bUnc;
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });
}

/** The id of the "Uncategorized" stream, if one exists. */
export function uncategorizedId(streams: Stream[]): string | undefined {
  return streams.find((s) => s.title === UNCATEGORIZED_TITLE)?.id;
}

/**
 * Display order for stream rows in the matrix: alphabetical, with neutral-area
 * streams last and "Uncategorized" pinned to the very bottom.
 */
export function streamsForDisplay(streams: Stream[]): Stream[] {
  const rank = (s: Stream) =>
    s.title === UNCATEGORIZED_TITLE ? 2 : s.area === 'neutral' ? 1 : 0;

  return [...streams].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}

/** Day-of-month options for a monthly recurrence. -1 means "last day". */
export const MONTH_DAY_OPTIONS = [...Array.from({ length: 31 }, (_, i) => i + 1), -1];

/** Label for a month_day value, e.g. 1 -> "1st", 22 -> "22nd", -1 -> "Last day". */
export function monthDayLabel(day: number): string {
  if (day === -1) return 'Last day';
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = day % 100;
  return `${day}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
}

export interface Card {
  id: string;
  user_id: string;
  stream_id: string;
  title: string;
  notes?: string;
  status: CardStatus;
  due_at?: string;
  remind_at?: string;
  position: number;
  is_recurring: boolean;
  recurrence_source_id?: string;
  last_completed_at?: string;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RecurrenceSource {
  id: string;
  user_id: string;
  stream_id: string;
  base_title: string;
  frequency?: string;
  interval?: number;
  weekdays?: any;
  month_day?: number;
  stack_missed: boolean;
  end_date?: string;
  stopped_at?: string;
  last_completed_at?: string;
}

export const ACTIVE_STATUSES: CardStatus[] = ['research', 'waiting', 'in_progress', 'review'];
export const BACKLOG_STATUSES: CardStatus[] = ['backlog', 'priority_backlog'];
export const ARCHIVE_STATUSES: CardStatus[] = ['complete', 'canceled'];

export const STATUS_LABELS: Record<CardStatus, string> = {
  backlog: 'Backlog',
  priority_backlog: 'Priority Backlog',
  research: 'Research',
  waiting: 'Waiting',
  in_progress: 'In Progress',
  review: 'Review',
  complete: 'Complete',
  canceled: 'Canceled',
};
