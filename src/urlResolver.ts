import { useState, useEffect, useCallback } from 'react';
import { loadSettings } from './settings';

const resolvedCache = new Map<string, string>();
const failedUrls = new Set<string>();
const subscribers = new Set<() => void>();

export const isDiscordCdnUrl = (url: string): boolean => {
  return (
    url.includes('cdn.discordapp.com/attachments/') ||
    url.includes('media.discordapp.net/attachments/')
  );
};

export const getWaybackFallbackUrl = (url: string): string => {
  const clean = url.split('?')[0];
  return `https://web.archive.org/web/id_/${clean}`;
};

export const getResolvedUrl = (url: string): string => {
  return resolvedCache.get(url) || url;
};

export const isUrlFailed = (url: string): boolean => {
  return failedUrls.has(url);
};

export const clearUrlResolverCache = (): void => {
  resolvedCache.clear();
  failedUrls.clear();
  notifySubscribers();
};

const notifySubscribers = () => {
  subscribers.forEach(cb => {
    try {
      cb();
    } catch {
    }
  });
};

export const subscribeToUrlResolver = (cb: () => void): (() => void) => {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
};

export function useResolvedUrl(originalUrl: string) {
  const [resolved, setResolved] = useState<string>(() => getResolvedUrl(originalUrl));
  const [isFailed, setIsFailed] = useState<boolean>(() => isUrlFailed(originalUrl));

  useEffect(() => {
    setResolved(getResolvedUrl(originalUrl));
    setIsFailed(isUrlFailed(originalUrl));

    return subscribeToUrlResolver(() => {
      setResolved(getResolvedUrl(originalUrl));
      setIsFailed(isUrlFailed(originalUrl));
    });
  }, [originalUrl]);

  const reportError = useCallback(() => {
    const currentResolved = resolvedCache.get(originalUrl) || originalUrl;

    if (currentResolved !== originalUrl) {
      failedUrls.add(originalUrl);
      setIsFailed(true);
      notifySubscribers();
      return;
    }

    const settings = loadSettings();
    if (settings.enableWaybackFallback && isDiscordCdnUrl(originalUrl)) {
      const fallback = getWaybackFallbackUrl(originalUrl);
      resolvedCache.set(originalUrl, fallback);
      setResolved(fallback);
      notifySubscribers();
    } else {
      failedUrls.add(originalUrl);
      setIsFailed(true);
      notifySubscribers();
    }
  }, [originalUrl]);

  return {
    resolvedUrl: resolved,
    isFailed,
    reportError,
  };
}
