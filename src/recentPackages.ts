export interface RecentPackage {
  path: string;
  name: string;
  type: 'folder' | 'zip';
  lastOpened: number;
  totalMessages?: number;
}

const STORAGE_KEY = 'discord_archiver_recent_packages';
const MAX_RECENT = 5;

export const getRecentPackages = (): RecentPackage[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, MAX_RECENT);
    }
    return [];
  } catch {
    return [];
  }
};

export const addRecentPackage = (
  path: string,
  totalMessages?: number
): RecentPackage[] => {
  try {
    const current = getRecentPackages().filter(p => p.path !== path);
    const isZip = path.toLowerCase().endsWith('.zip');
    const normalized = path.replace(/\\/g, '/');
    const name = normalized.split('/').filter(Boolean).pop() || path;

    const newEntry: RecentPackage = {
      path,
      name,
      type: isZip ? 'zip' : 'folder',
      lastOpened: Date.now(),
      totalMessages,
    };

    const updated = [newEntry, ...current].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getRecentPackages();
  }
};

export const removeRecentPackage = (path: string): RecentPackage[] => {
  try {
    const updated = getRecentPackages().filter(p => p.path !== path);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return getRecentPackages();
  }
};

export const clearRecentPackages = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
  }
};
