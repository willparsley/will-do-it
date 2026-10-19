'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { ArrowLeft, Mail, UserRound } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { watchAccount } from '@/lib/supabase/account-boundary';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PushSettings } from '@/components/PushSettings';
import { AccountMenu } from '@/components/AccountMenu';

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const client = createClient();
    const boundary = watchAccount(client, signedOut => {
      setUser(null);
      window.location.replace(signedOut ? '/login' : '/profile');
    });
    void client.auth.getUser().then(({ data: { user }, error }) => {
      if (!boundary.active) return;
      if (error || !user) window.location.replace('/login');
      else if (boundary.acceptUser(user.id)) setUser(user);
    });
    return () => boundary.dispose();
  }, []);

  if (!user) return <main className="min-h-dvh flex items-center justify-center text-ink-soft">Loading your profile...</main>;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-chrome/80">
        <div className="px-4 sm:px-6 lg:px-8 min-h-14 py-1 flex flex-wrap items-center justify-between gap-2">
          <Link href="/" aria-label="Will Do It workspace" className="focus-ring rounded"><BrandLogo /></Link>
          <div className="flex items-center gap-2"><ThemeToggle /><AccountMenu email={user.email} /></div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm text-ink-soft hover:text-ink focus-ring rounded mb-6">
          <ArrowLeft size={16} aria-hidden="true" /> Back to workspace
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <UserRound size={24} aria-hidden="true" />
          <h1 className="text-2xl font-semibold">Your profile</h1>
        </div>
        <section aria-labelledby="account-details" className="rounded-xl border border-line bg-surface p-6">
          <h2 id="account-details" className="font-semibold mb-5">Account details</h2>
          <dl>
            <dt className="flex items-center gap-2 text-sm text-ink-soft mb-2"><Mail size={16} aria-hidden="true" /> Email address</dt>
            <dd className="break-all">{user.email || 'No email address available'}</dd>
          </dl>
        </section>
        <PushSettings key={user.id} userId={user.id} />
      </main>
    </div>
  );
}
