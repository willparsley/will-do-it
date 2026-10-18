'use client';

import { useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';
import { TooltipButton } from './TooltipButton';

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerTheme() { return 'light' as const; }

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';

    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    try { localStorage.setItem('theme', newTheme); } catch { /* The toggle still works without storage. */ }
  };

  return (
    <TooltipButton
      tooltip={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onPress={toggleTheme}
      className="min-h-11 min-w-11 flex items-center justify-center p-2 rounded-lg text-ink-soft hover:text-ink hover:bg-sunken transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </TooltipButton>
  );
}
