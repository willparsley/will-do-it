'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

const supabase = createClient();

export default function Login() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
      toast.success('Check your email for the login link');
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-canvas">
        <div className="max-w-sm text-center">
          <h1 className="text-2xl font-semibold mb-4 text-ink">Check your inbox</h1>
          <p className="text-ink-soft">
            We sent a magic link to <strong>{email}</strong>. Click the link to sign in.
          </p>
          <p className="text-xs text-ink-muted mt-4">
            You can close this tab after clicking the link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-canvas">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Will Do It</h1>
          <p className="text-ink-muted mt-2">Sign in with a magic link</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="field-label">
              Email address
            </label>
            <input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="control px-4 py-3"
              required
              autoFocus
            />
            <p className="text-xs text-ink-muted mt-1.5">
              We'll send a magic link to this email. No password required.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !email}
            className="btn btn-primary w-full py-3"
          >
            {loading ? 'Sending magic link...' : 'Send magic link'}
          </button>
        </form>

        <p className="text-center text-xs text-ink-muted mt-6">
          Make sure email authentication is enabled in your Supabase project.
        </p>
      </div>
    </div>
  );
}
