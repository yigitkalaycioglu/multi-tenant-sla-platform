import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'sla-theme';

function read(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* gizli sekme / kapali depolama */
  }
  return 'system';
}

/**
 * Tema tercihi.
 * "system" hicbir isaret birakmaz; acik/koyu secimi <html data-theme> ile
 * damgalanir ve CSS'te isletim sistemi tercihini ezer.
 */
export function useTheme(): { theme: ThemePreference; setTheme: (next: ThemePreference) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<ThemePreference>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* yok say */
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => setThemeState(next), []);

  const toggle = useCallback(() => {
    setThemeState((current) => {
      if (current === 'system') {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        return systemDark ? 'light' : 'dark';
      }
      return current === 'dark' ? 'light' : 'dark';
    });
  }, []);

  return { theme, setTheme, toggle };
}
