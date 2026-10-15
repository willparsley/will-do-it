'use client';

import { useRef, useState } from 'react';
import { Button, Calendar, CalendarCell, CalendarGrid, Dialog, DialogTrigger, Heading, Popover } from 'react-aria-components';
import { getLocalTimeZone, parseDate, today } from '@internationalized/date';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { withCalendarDay } from '@/lib/dates';
import styles from './CardDateField.module.css';

interface CardDateFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  dueAt?: string;
}

/** A day is the primary choice; time is an optional, separate control. */
export function CardDateField({ id, label, value, onChange, disabled, dueAt }: CardDateFieldProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusTime = useRef(false);
  if (disabled && open) setOpen(false);
  const day = value ? parseDate(value.slice(0, 10)) : null;
  const time = value.slice(11, 16);
  const hasTime = !!time && time !== '00:00';
  // Treat local midnight as a day-only selection, while preserving the stored
  // instant in the parent form when no actual edit has been made.
  const [timeExpanded, setTimeExpanded] = useState(hasTime);
  const display = day ? new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  }).format(day.toDate(getLocalTimeZone())) : 'Pick a date';
  const choose = (nextDay: string, fallbackTime?: string) => {
    if (disabled) return;
    onChange(withCalendarDay(value, nextDay, fallbackTime));
    setOpen(false);
  };
  const clear = () => { if (!disabled) { onChange(''); setTimeExpanded(false); triggerRef.current?.focus(); } };

  return (
    <div id={`${id}-field`} className={styles.field} role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="field-label">{label}</span>
      <div className={styles.dateRow}>
        <DialogTrigger isOpen={open && !disabled} onOpenChange={setOpen}>
          <Button ref={triggerRef} id={id} isDisabled={disabled} className={`${styles.trigger} focus-ring`} aria-label={`${label}: ${display}`} aria-describedby="card-date-help">
            <CalendarDays size={18} aria-hidden="true" /><span>{display}</span>
          </Button>
          <Popover className={styles.popover} placement="bottom start" offset={6} onClick={event => event.stopPropagation()}>
            <Dialog aria-label={`Choose ${label.toLowerCase()}`} className={styles.dialog}>
              <div onKeyDownCapture={event => {
                if (event.key === 'Escape') {
                  event.preventDefault(); event.stopPropagation();
                  setOpen(false); triggerRef.current?.focus();
                }
              }}>
              <Calendar autoFocus aria-label={label} value={day} onChange={date => choose(date.toString())} isDisabled={disabled}>
                <header className={styles.calendarHeader}>
                  <Button slot="previous" className={`${styles.iconButton} focus-ring`} aria-label="Previous month"><ChevronLeft size={20} /></Button>
                  <Heading className={styles.month} />
                  <Button slot="next" className={`${styles.iconButton} focus-ring`} aria-label="Next month"><ChevronRight size={20} /></Button>
                </header>
                <CalendarGrid className={styles.grid} weekdayStyle="short">
                  {date => <CalendarCell date={date} className={styles.day} />}
                </CalendarGrid>
              </Calendar>
              <Button className={`${styles.done} focus-ring`} onPress={() => setOpen(false)}>Done</Button>
              </div>
            </Dialog>
          </Popover>
        </DialogTrigger>
        {value && <button type="button" onClick={clear} disabled={disabled} className={`${styles.iconButton} focus-ring`} aria-label={`Clear ${label.toLowerCase()}`}><X size={18} aria-hidden="true" /></button>}
      </div>
      <div className={styles.shortcuts}>
        <button type="button" disabled={disabled} onClick={() => choose(today(getLocalTimeZone()).toString())} className={`${styles.shortcut} focus-ring`}>Today</button>
        <button type="button" disabled={disabled} onClick={() => choose(today(getLocalTimeZone()).add({ days: 1 }).toString())} className={`${styles.shortcut} focus-ring`}>Tomorrow</button>
        {dueAt && <button type="button" disabled={disabled} onClick={() => {
          const fallbackTime = dueAt.slice(11, 16) || '00:00';
          choose(parseDate(dueAt.slice(0, 10)).subtract({ days: 1 }).toString(), fallbackTime);
          if (!value && fallbackTime !== '00:00') setTimeExpanded(true);
        }} className={`${styles.shortcut} focus-ring`}>Day before due</button>}
      </div>
      {value && (timeExpanded || hasTime ? <div className={styles.timeRow}>
        <label htmlFor={`${id}-time`} className={styles.timeLabel}><Clock size={16} aria-hidden="true" />Time</label>
        <input ref={element => {
          if (element && focusTime.current) { element.focus(); focusTime.current = false; }
        }} id={`${id}-time`} aria-label={`${label} time`} type="time" value={time || '00:00'} disabled={disabled}
          onChange={event => {
            onChange(`${value.slice(0, 10)}T${event.target.value || '00:00'}`);
          }} className={`control ${styles.time}`} />
        <button type="button" disabled={disabled} className={`${styles.iconButton} focus-ring`} aria-label={`Remove ${label.toLowerCase()} time`} onClick={() => {
          onChange(`${value.slice(0, 10)}T00:00`); setTimeExpanded(false); triggerRef.current?.focus();
        }}><X size={16} aria-hidden="true" /></button>
      </div> : <button type="button" disabled={disabled} className={`${styles.addTime} focus-ring`} onClick={() => {
        focusTime.current = true; onChange(`${value.slice(0, 10)}T09:00`); setTimeExpanded(true);
      }}><Clock size={16} aria-hidden="true" />Add time</button>)}
    </div>
  );
}
