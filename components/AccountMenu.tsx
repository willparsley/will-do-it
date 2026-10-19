'use client';

import { useState } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { disablePush } from '@/lib/push';
import { errorMessage } from '@/lib/errors';
import { TooltipButton } from './TooltipButton';
import styles from './HeaderControls.module.css';

export function AccountMenu({ email }: { email?: string }) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      // Browser revocation also works when server cleanup is unavailable.
      await disablePush().catch(() => undefined);
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
      window.location.replace('/login');
    } catch (error) {
      setSigningOut(false);
      toast.error(errorMessage(error, 'Could not log out. Please try again.'));
    }
  }

  return (
    <MenuTrigger>
      <TooltipButton tooltip="View your profile or log out" aria-label="Account menu" isDisabled={signingOut}
        className="btn btn-ghost focus-ring min-h-11 px-2 text-sm">
        <UserRound size={18} aria-hidden="true" />
        <span>Account</span><ChevronDown size={14} aria-hidden="true" />
      </TooltipButton>
      <Popover placement="bottom end" offset={8} className={styles.popover}>
        <div className={styles.identity}>
          <p className="text-xs text-ink-soft mb-1">Signed in as</p>
          <p>{email || 'No email address available'}</p>
        </div>
        <Menu aria-label="Account" className={styles.menu} disabledKeys={signingOut ? ['logout'] : []}>
          <MenuItem id="profile" href="/profile" className={styles.item} textValue="Profile">
            <UserRound size={16} aria-hidden="true" /> Profile
          </MenuItem>
          <MenuItem id="logout" onAction={() => void signOut()} className={styles.item} textValue="Log out">
            <LogOut size={16} aria-hidden="true" /> Log out
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
