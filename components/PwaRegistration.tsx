'use client';

import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;

    // Do not let the worker cache development builds or interrupt an open editor.
    void navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch((error: unknown) => {
      console.error('Could not register offline support', error);
    });

    // A top-layer read-only view also blocks open editors/drag actions when a
    // connection drops. Keep the React tree mounted so drafts survive reconnect.
    let offlineDialog: HTMLDialogElement | undefined;
    const closeOffline = () => { offlineDialog?.close(); offlineDialog?.remove(); offlineDialog = undefined; };
    const showOffline = () => {
      if (offlineDialog || !navigator.serviceWorker.controller) return;
      offlineDialog = document.createElement('dialog');
      offlineDialog.setAttribute('aria-label', 'Offline workspace');
      offlineDialog.style.cssText = 'position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;max-height:none;margin:0;padding:0;border:0;';
      const frame = document.createElement('iframe');
      frame.title = 'Read-only saved workspace';
      frame.src = '/offline.html';
      frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
      offlineDialog.append(frame);
      offlineDialog.addEventListener('cancel', event => event.preventDefault());
      document.body.append(offlineDialog);
      offlineDialog.showModal();
    };
    window.addEventListener('offline', showOffline);
    window.addEventListener('online', closeOffline);
    if (!navigator.onLine) showOffline();
    return () => {
      window.removeEventListener('offline', showOffline);
      window.removeEventListener('online', closeOffline);
      closeOffline();
    };
  }, []);

  return null;
}
