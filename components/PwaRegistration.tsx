'use client';

import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    // Keep edge-to-edge opt-in scoped to installed Android windows. Other
    // browsers retain their current viewport and safe-area behavior.
    const standalone = window.matchMedia('(display-mode: standalone)');
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport || !/Android/i.test(navigator.userAgent)) return;
    const originalViewport = viewport.content.replace(/,\s*viewport-fit=[^,]+/g, '');
    const updateDisplay = () => {
      document.documentElement.toggleAttribute('data-android-pwa', standalone.matches);
      viewport.content = standalone.matches
        ? `${originalViewport}, viewport-fit=cover`
        : originalViewport;
    };
    updateDisplay();
    standalone.addEventListener('change', updateDisplay);
    return () => standalone.removeEventListener('change', updateDisplay);
  }, []);

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
