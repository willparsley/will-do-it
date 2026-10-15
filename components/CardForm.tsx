'use client';

import { createContext, useContext, useEffect, useId, type ReactNode } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { X } from 'lucide-react';
import { AppSelect } from './AppSelect';
import { type CardStatus, type Stream, STATUS_LABELS } from '@/lib/types';
import styles from './CardForm.module.css';

/** One dismissal path for backdrop, Escape, Cancel, and the close button. */
export function CardFormDialog({ title, dirty, saving, onClose, children }: {
  title: string; dirty: boolean; saving: boolean; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const close = () => {
    if (!saving && (!dirty || confirm('Discard unsaved card changes?'))) onClose();
  };
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  return (
    <ModalOverlay isOpen isDismissable={!saving} isKeyboardDismissDisabled={saving}
      onOpenChange={open => { if (!open) close(); }} className="modal-backdrop">
      <Modal className={`modal-panel ${styles.panel}`}>
        <Dialog aria-labelledby={titleId} className="outline-none">
        <div className={styles.dialog} onKeyDownCapture={event => {
          // Select triggers consume Escape even when closed. An open menu gets
          // the first Escape; otherwise use the dialog's protected dismissal.
          if (event.key === 'Escape' && !event.currentTarget.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}>
          <header className={styles.header}>
            <h2 id={titleId} className="text-xl font-semibold text-ink">{title}</h2>
            <button type="button" onClick={close} disabled={saving} aria-label="Close card form" className="btn btn-ghost focus-ring h-11 w-11"><X size={20} /></button>
          </header>
          {/* Cancel shares the same protected dismissal as Escape and the backdrop. */}
          <CardCloseContext.Provider value={close}>{children}</CardCloseContext.Provider>
        </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

const CardCloseContext = createContext<() => void>(() => {});
export function CardFormCancel({ disabled }: { disabled: boolean }) {
  const close = useContext(CardCloseContext);
  return <button type="button" onClick={close} disabled={disabled} className="btn btn-secondary focus-ring px-5 py-2.5">Cancel</button>;
}

export const cardFormStyles = styles;

// Pure render helpers keep both forms' labels, spacing, and optional sections identical.
export function cardFields({ title, setTitle, streamId, setStreamId, status, setStatus, streams, saving, dueAt, setDueAt, remindAt, setRemindAt, notes, setNotes, recurring = false, datesInitiallyOpen = false, notesInitiallyOpen = false }: {
  title: string; setTitle: (value: string) => void;
  streamId: string; setStreamId: (value: string) => void;
  status: CardStatus; setStatus: (value: CardStatus) => void;
  streams: Stream[]; saving: boolean;
  dueAt: string; setDueAt: (value: string) => void;
  remindAt: string; setRemindAt: (value: string) => void;
  notes: string; setNotes: (value: string) => void; recurring?: boolean; datesInitiallyOpen?: boolean; notesInitiallyOpen?: boolean;
}) {
  return <>
    <div>
      <label htmlFor="card-title" className="field-label">Title</label>
      <input id="card-title" type="text" value={title} onChange={e => setTitle(e.target.value)} className="control" placeholder="What needs to be done?" required autoFocus />
    </div>
    <div className={styles.placement}>
      <div>
        <label htmlFor="card-stream" className="field-label">Stream</label>
        <AppSelect id="card-stream" value={streamId} onValueChange={setStreamId} aria-label="Stream" disabled={saving}
          options={streams.map(stream => ({ value: stream.id, label: stream.title + (stream.state !== 'in_progress' ? ' (closed)' : '') }))} />
      </div>
      <div>
        <label htmlFor="card-status" className="field-label">Status</label>
        <AppSelect id="card-status" value={status} onValueChange={value => setStatus(value as CardStatus)} aria-label="Status" disabled={saving}
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      </div>
    </div>
    {recurring && <p className={styles.help}>Moving this card to another stream also moves pending occurrences and sets the stream for future ones.</p>}
    <details className={styles.section} open={datesInitiallyOpen ? true : undefined}>
      <summary className="focus-ring">Dates &amp; reminder <span className={styles.optional}>Optional</span></summary>
      <div className={styles.sectionBody}>
        <p id="card-date-help" className={styles.help}>Dates use your local time. Due and reminder days bring backlog cards into Waiting. Reminders appear in the app; no notification is sent.</p>
        <div>
          <label htmlFor="card-due" className="field-label">Due date &amp; time</label>
          <input id="card-due" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className="control" aria-describedby="card-date-help" />
        </div>
        <div>
          <label htmlFor="card-reminder" className="field-label">Reminder date &amp; time</label>
          <input id="card-reminder" type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)} className="control" aria-describedby="card-date-help" />
        </div>
        {(status === 'complete' || status === 'canceled') && <p className={styles.help}>Completed and canceled cards don’t show date badges. Their reminders are cleared when saved.</p>}
      </div>
    </details>
    <details className={styles.section} open={notesInitiallyOpen ? true : undefined}>
      <summary className="focus-ring">Notes <span className={styles.optional}>Optional</span></summary>
      <div className={styles.sectionBody}>
        <div><label htmlFor="card-notes" className="field-label">Notes</label>
        <textarea id="card-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={4} className="control" placeholder="Add details or context…" /></div>
      </div>
    </details>
  </>;
}
