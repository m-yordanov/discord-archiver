import { useState, useEffect } from 'react';

export type TimeFormat = '12h' | '24h';

export interface AppSettings {
  theme: 'dark' | 'midnight' | 'light';
  fontSize: 'small' | 'normal' | 'large';
  timeFormat: TimeFormat;
  enableWaybackFallback: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 'normal',
  timeFormat: '12h',
  enableWaybackFallback: false,
};

const STORAGE_KEY = 'discord_archiver_settings';
const listeners = new Set<(settings: AppSettings) => void>();

export const subscribeSettings = (cb: (settings: AppSettings) => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const applySettings = (settings: AppSettings): void => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.fontSize = settings.fontSize;
    document.documentElement.dataset.timeFormat = settings.timeFormat;
  }
};

export const loadSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      applySettings(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    const resolved: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
    applySettings(resolved);
    return resolved;
  } catch {
    applySettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
};

export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    applySettings(settings);
    listeners.forEach(cb => {
      try {
        cb(settings);
      } catch {
      }
    });
  } catch {
  }
};

export const resetSettings = (): AppSettings => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
  }
  applySettings(DEFAULT_SETTINGS);
  listeners.forEach(cb => {
    try {
      cb(DEFAULT_SETTINGS);
    } catch {
    }
  });
  return DEFAULT_SETTINGS;
};

export function useSettings(): AppSettings {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  useEffect(() => {
    return subscribeSettings(setSettings);
  }, []);

  return settings;
}
