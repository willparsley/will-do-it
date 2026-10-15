'use client';

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';
import { Check, ChevronDown } from 'lucide-react';
import styles from './AppSelect.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface AppSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label': string;
  className?: string;
  size?: 'default' | 'small' | 'compact';
}

/** Shared, custom-rendered select. The library's hidden select supports autofill only. */
export function AppSelect({ value, onValueChange, options, placeholder = 'Choose…', disabled = false, id, 'aria-label': label, className = 'w-full', size = 'default' }: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Forget an open menu when a save disables the control, including failed saves.
  if (disabled && open) setOpen(false);

  return (
    <Select
      aria-label={label}
      selectedKey={value || null}
      onSelectionChange={key => { if (key !== null && !disabled) onValueChange(String(key)); }}
      isDisabled={disabled}
      isOpen={open && !disabled}
      onOpenChange={setOpen}
      placeholder={placeholder}
      className={`${styles.root} ${styles[size] || ''} ${className}`}
      onKeyDown={event => {
        // The enclosing recurrence dialog also handles Escape. Let the menu close first.
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Button ref={triggerRef} id={id} type="button" className={styles.trigger}>
        <SelectValue className={styles.value} />
        <ChevronDown size={14} aria-hidden="true" className={`${styles.icon} ${styles.chevron}`} />
      </Button>
      <Popover
        className={`${styles.popover} ${styles[size] || ''}`}
        placement="bottom start"
        offset={4}
        maxHeight={320}
        onClick={event => event.stopPropagation()}
      >
        <div onKeyDown={event => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
          } else if (event.key === 'Tab') {
            // Remove the portal before the browser computes the next form tab stop.
            flushSync(() => setOpen(false));
            triggerRef.current?.focus();
          }
        }}>
          <ListBox items={options} className={styles.list} aria-label={label}>
            {option => (
              <ListBoxItem id={option.value} textValue={option.label} isDisabled={option.disabled} className={styles.item}>
                {({ isSelected }) => (
                  <>
                    <span className={styles.itemText}>{option.label}</span>
                    <Check size={14} aria-hidden="true" className={`${styles.icon} ${isSelected ? '' : styles.checkHidden}`} />
                  </>
                )}
              </ListBoxItem>
            )}
          </ListBox>
        </div>
      </Popover>
    </Select>
  );
}
