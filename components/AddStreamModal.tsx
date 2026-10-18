'use client';

import { AppSelect } from '@/components/AppSelect';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Stream, Area } from '@/lib/types';
import { toast } from 'sonner';

const supabase = createClient();

interface AddStreamModalProps {
  streams: Stream[];
  onClose: () => void;
  onStreamCreated: (stream: Stream) => void;
}

export function AddStreamModal({ streams, onClose, onStreamCreated }: AddStreamModalProps) {
  const [title, setTitle] = useState('');
  const [area, setArea] = useState<Area>('personal');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    if (trimmed.toLowerCase() === 'uncategorized') {
      toast.error('Cannot create a stream named "Uncategorized"');
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Calculate position: just above Uncategorized (or sensible default)
      const unc = streams.find((s) => s.title === 'Uncategorized');
      const uncPos = unc ? unc.position : 999;

      const nonUnc = streams.filter((s) => s.title !== 'Uncategorized');
      const maxNonUncPos = nonUnc.length > 0
        ? Math.max(...nonUnc.map((s) => s.position || 0))
        : 0;

      const newPosition = unc
        ? Math.min(uncPos - 1, maxNonUncPos + 10)
        : maxNonUncPos + 10;

      const { data: newStream, error } = await supabase
        .from('streams')
        .insert({
          user_id: user.id,
          title: trimmed,
          state: 'in_progress',
          area,
          position: newPosition,
        })
        .select()
        .single();

      if (error) throw error;

      if (newStream) {
        onStreamCreated(newStream as Stream);
        toast.success('Stream created');
        onClose();
      }
    } catch (err: unknown) {
      console.error(err);
      const message = typeof err === 'object' && err !== null && 'message' in err
        && typeof err.message === 'string' && err.message
        ? err.message : 'Failed to create stream';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-4 text-ink">New Stream</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="field-label">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="control"
              placeholder="e.g. Personal Projects, Work Q4"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="field-label">
              Area
            </label>
            <AppSelect
              value={area}
              onValueChange={value => setArea(value as Area)}
              className="w-full"
              aria-label="Area"
              disabled={loading}
              options={[{ value: 'personal', label: 'Personal' }, { value: 'work', label: 'Work' }, { value: 'neutral', label: 'Neutral' }]}
            />
            <p className="text-xs text-ink-muted mt-1">
              Used for Work / Personal filtering.
            </p>
          </div>

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
              type="submit"
              disabled={loading || !title.trim()}
              className="btn btn-primary flex-1 py-2.5"
            >
              {loading ? 'Creating...' : 'Create Stream'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
