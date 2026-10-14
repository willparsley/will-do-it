'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, Area, streamsForSelect } from '@/lib/types';
import { toast } from 'sonner';

const supabase = createClient();

interface EditStreamModalProps {
  stream: Stream;
  streams: Stream[];
  onClose: () => void;
  onStreamUpdated: (stream: Stream) => void;
  onStreamDeleted: (streamId: string, targetStreamId?: string) => void;
  /**
   * Applies a status change (handles the recurrence warning + persistence).
   * Returns false if the user declined, in which case the save is aborted.
   */
  onStateChange: (streamId: string, newState: Stream['state']) => Promise<boolean>;
}

export function EditStreamModal({ stream, streams, onClose, onStreamUpdated, onStreamDeleted, onStateChange }: EditStreamModalProps) {
  const [title, setTitle] = useState(stream.title);
  const [area, setArea] = useState<Area>(stream.area);
  const [state, setState] = useState<Stream['state']>(stream.state);
  const [notes, setNotes] = useState(stream.notes || '');
  const [loading, setLoading] = useState(false);

  // Delete rehome flow
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState('');

  const isUncategorized = stream.title === 'Uncategorized';

  const handleSave = async () => {
    if (!title.trim()) return;

    setLoading(true);

    try {
      // Status changes have their own flow (recurrence warning), so apply
      // that first and abort the whole save if the user declined.
      if (state !== stream.state) {
        const ok = await onStateChange(stream.id, state);
        if (!ok) {
          setLoading(false);
          return;
        }
      }

      const updates: any = {
        title: title.trim(),
        area,
        notes: notes.trim() || null,
      };

      const { data: updatedStream, error } = await supabase
        .from('streams')
        .update(updates)
        .eq('id', stream.id)
        .select()
        .single();

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

      // Move cards
      await supabase
        .from('cards')
        .update({ stream_id: deleteTargetId })
        .eq('stream_id', stream.id);

      // Move recurrence sources to the new target stream
      await supabase
        .from('recurrence_sources')
        .update({ stream_id: deleteTargetId })
        .eq('stream_id', stream.id);

      // Delete the stream
      const { error } = await supabase.from('streams').delete().eq('id', stream.id);
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
        className="modal-panel max-w-md p-6"
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
              onChange={(e) => setState(e.target.value as Stream['state'])}
              disabled={isUncategorized}
              className="control"
            >
              <option value="in_progress">Active</option>
              <option value="complete">Complete</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>

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
