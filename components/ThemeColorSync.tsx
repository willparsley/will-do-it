'use client';

import { useEffect } from 'react';

// Follow the resolved app theme, including a saved preference overriding the OS.
// Keep every theme-color tag consistent when the app's theme class changes.
export function ThemeColorSync() {
  useEffect(() => {
    const syncColor = () => {
      const color = document.documentElement.classList.contains('dark') ? '#00C177' : '#008751';
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach(meta => { meta.content = color; });
    };
    syncColor();
    const observer = new MutationObserver(syncColor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return null;
}
