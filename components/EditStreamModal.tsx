'use client';

import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { AppSelect } from '@/components/AppSelect';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, Area, RecurrenceSource, streamsForSelect } from '@/lib/types';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';

const supabase = createClient();

interface EditStreamModalProps {
  stream: Stream;
  streams: Stream[];
  onClose: () => void;
  onStreamUpdated: (stream: Stream) => void;
  onStreamDeleted: (streamId: string, targetStreamId?: string) => void;
}

export function EditStreamModal({ stream, streams, onClose, onStreamUpdated, onStreamDeleted }: EditStreamModalProps) {
  const [title, setTitle] = useState(stream.title);
  const [area, setArea] = useState<Area>(stream.area);
  const [state, setState] = useState<Stream['state']>(stream.state);
  const [notes, setNotes] = useState(stream.notes || '');
  const [loading, setLoading] = useState(false);
  const [closingSources, setClosingSources] = useState<RecurrenceSource[]>([]);
  const [choices, setChoices] = useState<Record<string, { action: string; stream_id?: string }>>({});
  const moveTargets = streamsForSelect(streams).filter(s => s.id !== stream.id);

  // Delete rehome flow
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState('');
  const [deleteHasCards, setDeleteHasCards] = useState(false);
  const [deleteHasSources, setDeleteHasSources] = useState(false);
  const deleteNeedsTarget = deleteHasCards || deleteHasSources;
  const deleteContents = deleteHasCards
    ? (deleteHasSources ? 'cards and recurrences' : 'cards')
    : 'recurrences';

  const isUncategorized = stream.title === 'Uncategorized';

  const handleSave = async () => {
    if (!title.trim()) return;

    setLoading(true);

    try {
      if (state !== 'in_progress') {
        const { data: sources, error: sourceError } = await supabase.rpc('recurrences_for_stream', {
          p_stream_id: stream.id,
          p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        if (sourceError) throw sourceError;
        const currentSources = (sources || []) as RecurrenceSource[];
        setClosingSources(currentSources);
        if (currentSources.some(source => !choices[source.id]?.action ||
          (choices[source.id].action === 'move' && !choices[source.id].stream_id))) return;
      }

      const { data: updatedStream, error } = await supabase.rpc('save_stream', {
        p_stream_id: stream.id,
        p_title: title.trim(),
        p_area: area,
        p_notes: notes.trim() || null,
        p_state: state,
        p_recurrences: Object.entries(choices).map(([source_id, choice]) => ({ source_id, ...choice })),
      }).single<Stream>();

      if (error) throw error;

      onStreamUpdated(updatedStream as Stream);
      toast.success('Stream updated');
      onClose();
    } catch (err: unknown) {
      console.error(err);
      toast.error(errorMessage(err, 'Failed to update stream'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (isUncategorized) {
      toast.error('Cannot delete the Uncategorized stream');
      return;
    }

    setLoading(true);
    try {
      // Check stored contents, including cards hidden by the current board filters.
      const [cards, sources] = await Promise.all([
        supabase.from('cards').select('id', { count: 'exact', head: true }).eq('stream_id', stream.id),
        supabase.from('recurrence_sources').select('id', { count: 'exact', head: true }).eq('stream_id', stream.id),
      ]);
      if (cards.error) throw cards.error;
      if (sources.error) throw sources.error;
      setDeleteHasCards((cards.count ?? 0) > 0);
      setDeleteHasSources((sources.count ?? 0) > 0);

      const defaultTarget = moveTargets.find(s => s.title === 'Uncategorized')?.id
        || moveTargets[0]?.id
        || '';
      setDeleteTargetId(defaultTarget);
      setShowDeleteConfirm(true);
    } catch (err: unknown) {
      console.error(err);
      toast.error(errorMessage(err, 'Failed to check stream contents'));
    } finally {
      setLoading(false);
    }
  };

  const confirmDeleteWithRehome = async () => {
    if (!deleteTargetId) {
      toast.error('Please choose an active destination stream');
      return;
    }

    setLoading(true);

    try {
      const targetStream = streams.find(s => s.id === deleteTargetId);
      if (!targetStream) throw new Error('Target stream not found');

      const { error } = await supabase.rpc('delete_stream_rehoming', {
        p_stream_id: stream.id,
        p_target_id: deleteTargetId,
      });
      if (error) throw error;

      onStreamDeleted(stream.id, deleteTargetId);
      toast.success(deleteNeedsTarget
        ? `Stream deleted. ${deleteHasCards ? 'Cards' : 'Recurrences'} moved to "${targetStream.title}".`
        : 'Stream deleted');
      onClose();
    } catch (err: unknown) {
      console.error(err);
      toast.error(errorMessage(err, 'Failed to delete stream'));
    } finally {
      setLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setDeleteTargetId('');
  };

  return (
    <ModalOverlay isOpen isDismissable={!loading} isKeyboardDismissDisabled={loading}
      onOpenChange={open => { if (!open) onClose(); }} className="modal-backdrop">
      <Modal className="modal-panel max-w-md p-6 max-h-[90dvh] overflow-y-auto">
      <Dialog aria-label="Edit Stream" className="outline-none">
      <div onKeyDownCapture={event => {
        // An open dropdown consumes Escape first; a closed select must allow dismissal.
        if (event.key === 'Escape' && !loading && !event.currentTarget.querySelector('[aria-expanded="true"]')) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}>
        <h2 className="text-xl font-semibold mb-4 text-ink">
          Edit Stream
        </h2>

        <div className="space-y-4">
          <div>
            <label className="field-label" htmlFor="stream-title">
              Title
            </label>
            <input
              id="stream-title"
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUncategorized}
              className="control"
            />
          </div>

          <div>
            <label className="field-label">
              Area
            </label>
            <AppSelect
              value={area}
              onValueChange={value => setArea(value as Area)}
              disabled={isUncategorized || loading}
              className="w-full"
              aria-label="Area"
              options={[{ value: 'personal', label: 'Personal' }, { value: 'work', label: 'Work' }, { value: 'neutral', label: 'Neutral' }]}
            />
          </div>

          <div>
            <label className="field-label">
              Status
            </label>
            <AppSelect
              value={state}
              onValueChange={value => { setState(value as Stream['state']); setClosingSources([]); setChoices({}); }}
              disabled={isUncategorized || loading}
              className="w-full"
              aria-label="Status"
              options={[{ value: 'in_progress', label: 'Active' }, { value: 'complete', label: 'Complete' }, { value: 'canceled', label: 'Canceled' }]}
            />
          </div>

          {state !== 'in_progress' && closingSources.length > 0 && (
            <div className="rounded-lg border border-line bg-sunken p-3 space-y-3">
              <p className="text-sm text-ink-soft">Choose what happens to each recurrence before closing this stream. Moving a recurrence also moves all its pending cards.</p>
              {closingSources.map(source => (
                <div key={source.id} className="space-y-2">
                  <label className="field-label" htmlFor={`recurrence-${source.id}`}>{source.base_title}</label>
                  <AppSelect
                    id={`recurrence-${source.id}`}
                    className="w-full"
                    value={choices[source.id]?.action || ''}
                    onValueChange={value => setChoices(prev => ({ ...prev, [source.id]: { action: value } }))}
                    aria-label={source.base_title}
                    placeholder="Choose an action"
                    disabled={loading}
                    options={[{ value: 'move', label: 'Move recurrence', disabled: moveTargets.length === 0 }, { value: 'stop', label: 'Stop future occurrences' }]}
                  />
                  {choices[source.id]?.action === 'move' && (
                    <AppSelect
                      aria-label={`Move ${source.base_title} to stream`}
                      className="w-full"
                      value={choices[source.id]?.stream_id || ''}
                      onValueChange={value => setChoices(prev => ({ ...prev, [source.id]: { ...prev[source.id], stream_id: value } }))}
                      placeholder="Choose an active stream"
                      disabled={loading}
                      options={moveTargets.map(target => ({ value: target.id, label: target.title }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="field-label">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isUncategorized}
              rows={3}
              className="control"
              placeholder="Optional notes about this stream..."
            />
          </div>

          {!showDeleteConfirm ? (
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-secondary flex-1 py-2.5"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading || !title.trim() || isUncategorized}
                className="btn btn-primary flex-1 py-2.5"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          ) : null}

          {!isUncategorized && !showDeleteConfirm && (
            <button
              onClick={handleDelete}
              disabled={loading}
              className="w-full text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 py-2"
            >
              Delete Stream
            </button>
          )}

          {showDeleteConfirm && (
            <div className="border border-line rounded-lg p-4 space-y-3 bg-sunken">
              <div className="text-sm font-medium text-ink-soft">
                {deleteNeedsTarget ? `Delete stream and move its ${deleteContents}?` : 'Delete this empty stream?'}
              </div>

              {deleteNeedsTarget && <div>
                <label className="block text-xs font-medium mb-1 text-ink-soft">
                  Move {deleteContents} to
                </label>
                <AppSelect
                  value={deleteTargetId}
                  onValueChange={value => setDeleteTargetId(value)}
                  className="w-full"
                  size="small"
                  disabled={loading}
                  aria-label={`Move ${deleteContents} to`}
                  options={moveTargets.map(s => ({ value: s.id, label: s.title + (s.title === 'Uncategorized' ? ' (recommended)' : '') }))}
                />
              </div>}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={cancelDelete}
                  disabled={loading}
                  className="btn btn-secondary flex-1 py-2 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteWithRehome}
                  disabled={loading || !deleteTargetId}
                  className="btn btn-danger flex-1 py-2 text-sm"
                >
                  {loading ? 'Deleting...' : deleteNeedsTarget ? `Delete & Move ${deleteHasCards ? 'Cards' : 'Recurrences'}` : 'Delete Stream'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
