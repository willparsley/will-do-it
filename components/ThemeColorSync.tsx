'use client';

import { useEffect } from 'react';

// Match ParsleyPantry's runtime color handling, using Will Do It's logo green.
// Keep every theme-color tag consistent when the app's theme class changes.
export function ThemeColorSync() {
  useEffect(() => {
    const syncColor = () => {
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach(meta => { meta.content = '#00995B'; });
    };
    syncColor();
    const observer = new MutationObserver(syncColor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return null;
}
