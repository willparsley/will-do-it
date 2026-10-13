export type StreamState = 'backlog' | 'in_progress' | 'complete' | 'canceled';
export type CardStatus =
  | 'prioritized_backlog'
  | 'regular_backlog'
  | 'research'
  | 'waiting'
  | 'in_progress'
  | 'review'
  | 'complete'
  | 'canceled';

export type Area = 'work' | 'personal' | 'neutral';

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
export const BACKLOG_STATUSES: CardStatus[] = ['regular_backlog', 'prioritized_backlog'];
export const ARCHIVE_STATUSES: CardStatus[] = ['complete', 'canceled'];

export const STATUS_LABELS: Record<CardStatus, string> = {
  prioritized_backlog: 'Prioritized',
  regular_backlog: 'Regular',
  research: 'Research',
  waiting: 'Waiting',
  in_progress: 'In Progress',
  review: 'Review',
  complete: 'Complete',
  canceled: 'Canceled',
};
