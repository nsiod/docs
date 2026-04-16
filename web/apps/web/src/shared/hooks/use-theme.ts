import { useEffect, useState } from 'react';
import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = 'nsio-theme';

function readInitial(): Theme {
  if (typeof window === 'undefined')
    return 'system';
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === 'light' || v === 'dark' || v === 'system')
    return v;
  return 'system';
}

function applyTheme(theme: Theme): Resolved {
  const resolved: Resolved
    = theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  return resolved;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: typeof window === 'undefined' ? 'system' : readInitial(),
  setTheme: (t) => {
    window.localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
    set({ theme: t });
  },
}));

export function useTheme(): {
  theme: Theme;
  resolvedTheme: Resolved;
  setTheme: (t: Theme) => void;
} {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [resolved, setResolved] = useState<Resolved>(() => {
    if (typeof window === 'undefined')
      return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  useEffect(() => {
    setResolved(applyTheme(theme));
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system')
      return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setResolved(applyTheme('system'));
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  return { theme, resolvedTheme: resolved, setTheme };
}
