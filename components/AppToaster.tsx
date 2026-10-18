'use client';

import { useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';

// The root class already resolves saved preferences and the initial OS theme.
// Observe that same source so open notifications also follow the app toggle.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerTheme() {
  return 'light' as const;
}

export function AppToaster() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  return (
    <Toaster
      theme={theme}
      position="top-right"
      offset={{ top: 124, right: 16 }}
      mobileOffset={{ top: 124, right: 12 }}
      richColors
      closeButton
    />
  );
}
