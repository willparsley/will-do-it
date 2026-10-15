'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, Area, RecurrenceSource, streamsForSelect } from '@/lib/types';
import { toast } from 'sonner';

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
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to update stream');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (isUncategorized) {
      toast.error('Cannot delete the Uncategorized stream');
      return;
    }

    // Enter delete confirmation mode with rehome choice
    const defaultTarget = streams.find(s => s.title === 'Uncategorized' && s.id !== stream.id)?.id 
      || streams.find(s => s.id !== stream.id)?.id 
      || '';

    setDeleteTargetId(defaultTarget);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteWithRehome = async () => {
    if (!deleteTargetId) {
      toast.error('Please choose a stream to move cards to');
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
      toast.success(`Stream deleted. Cards moved to "${targetStream.title}".`);
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to delete stream');
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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-md p-6 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4 text-ink">
          Edit Stream
        </h2>

        <div className="space-y-4">
          <div>
            <label className="field-label">
              Title
            </label>
            <input
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
            <select
              value={area}
              onChange={(e) => setArea(e.target.value as Area)}
              disabled={isUncategorized}
              className="control"
            >
              <option value="personal">Personal</option>
              <option value="work">Work</option>
              <option value="neutral">Neutral</option>
            </select>
          </div>

          <div>
            <label className="field-label">
              Status
            </label>
            <select
              value={state}
              onChange={(e) => { setState(e.target.value as Stream['state']); setClosingSources([]); setChoices({}); }}
              disabled={isUncategorized}
              className="control"
            >
              <option value="in_progress">Active</option>
              <option value="complete">Complete</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>

          {state !== 'in_progress' && closingSources.length > 0 && (
            <div className="rounded-lg border border-line bg-sunken p-3 space-y-3">
              <p className="text-sm text-ink-soft">Choose what happens to each recurrence before closing this stream. Moving a recurrence also moves all its pending cards.</p>
              {closingSources.map(source => (
                <div key={source.id} className="space-y-2">
                  <label className="field-label" htmlFor={`recurrence-${source.id}`}>{source.base_title}</label>
                  <select id={`recurrence-${source.id}`} className="control" value={choices[source.id]?.action || ''}
                    onChange={e => setChoices(prev => ({ ...prev, [source.id]: { action: e.target.value } }))}>
                    <option value="">Choose an action</option>
                    <option value="move" disabled={moveTargets.length === 0}>Move recurrence</option>
                    <option value="stop">Stop future occurrences</option>
                  </select>
                  {choices[source.id]?.action === 'move' && (
                    <select aria-label={`Move ${source.base_title} to stream`} className="control" value={choices[source.id]?.stream_id || ''}
                      onChange={e => setChoices(prev => ({ ...prev, [source.id]: { ...prev[source.id], stream_id: e.target.value } }))}>
                      <option value="">Choose an active stream</option>
                      {moveTargets.map(target => <option key={target.id} value={target.id}>{target.title}</option>)}
                    </select>
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
                Delete stream and move its cards?
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 text-ink-soft">
                  Move cards to
                </label>
                <select
                  value={deleteTargetId}
                  onChange={(e) => setDeleteTargetId(e.target.value)}
                  className="control text-sm"
                  disabled={loading}
                >
                  {streamsForSelect(streams)
                    .filter(s => s.id !== stream.id)
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {s.title}{s.title === 'Uncategorized' ? ' (recommended)' : ''}
                      </option>
                    ))}
                </select>
              </div>

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
                  {loading ? 'Deleting...' : 'Delete & Move Cards'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
