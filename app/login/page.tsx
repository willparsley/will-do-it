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
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950">
        <div className="max-w-sm text-center">
          <h1 className="text-2xl font-semibold mb-4">Check your inbox</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            We sent a magic link to <strong>{email}</strong>. Click the link to sign in.
          </p>
          <p className="text-xs text-zinc-500 mt-4">
            You can close this tab after clicking the link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Will Do It</h1>
          <p className="text-zinc-500 mt-2">Sign in with a magic link</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5 text-zinc-700 dark:text-zinc-300">
              Email address
            </label>
            <input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
              required
              autoFocus
            />
            <p className="text-xs text-zinc-500 mt-1.5">
              We'll send a magic link to this email. No password required.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full py-3 rounded-lg bg-zinc-900 hover:bg-black text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 font-medium disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-500 dark:disabled:text-zinc-400 transition-colors"
          >
            {loading ? 'Sending magic link...' : 'Send magic link'}
          </button>
        </form>

        <p className="text-center text-xs text-zinc-500 mt-6">
          Make sure email authentication is enabled in your Supabase project.
        </p>
      </div>
    </div>
  );
}
