import { openUrl } from '@tauri-apps/plugin-opener';

type FailureListener = (message: string) => void;

const failureListeners = new Set<FailureListener>();

export const isWebUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const reportFailure = (message: string) => {
  failureListeners.forEach(listener => listener(message));
};

export const openExternal = async (url: string): Promise<void> => {
  if (!isWebUrl(url)) {
    reportFailure('Only web links can be opened');
    return;
  }
  try {
    await openUrl(url);
  } catch {
    reportFailure('Could not open the link in your browser');
  }
};

export const onExternalOpenFailure = (listener: FailureListener): (() => void) => {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
};
