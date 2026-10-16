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
  }, []);

  return null;
}
