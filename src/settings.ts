export interface AppSettings {
  theme: 'dark' | 'midnight' | 'light';
  fontSize: 'small' | 'normal' | 'large';
  enableWaybackFallback: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontSize: 'normal',
  enableWaybackFallback: false,
};

const STORAGE_KEY = 'discord_archiver_settings';

export const applySettings = (settings: AppSettings): void => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.fontSize = settings.fontSize;
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
    const resolved = {
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
  } catch {
  }
};
