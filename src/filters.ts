import { Message } from './types';
import { isImage, isVideo, isOtherFile } from './attachments';

export type DateMode = 'any' | 'before' | 'after' | 'between';
export type AttachmentMode = 'any' | 'has' | 'none' | 'images' | 'videos' | 'files';

export interface MessageFilters {
  dateMode: DateMode;
  dateFrom: string;
  dateTo: string;
  attachment: AttachmentMode;
}

export const EMPTY_FILTERS: MessageFilters = {
  dateMode: 'any',
  dateFrom: '',
  dateTo: '',
  attachment: 'any',
};

export const parseMessageDate = (timestamp: string) => new Date(timestamp.replace(' ', 'T'));

const dayBoundary = (value: string, endOfDay: boolean) => {
  if (!value) return null;
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const matchesDate = (message: Message, filters: MessageFilters) => {
  if (filters.dateMode === 'any') return true;

  const time = parseMessageDate(message.timestamp).getTime();
  if (Number.isNaN(time)) return false;

  if (filters.dateMode === 'before') {
    const limit = dayBoundary(filters.dateFrom, true);
    return limit === null || time <= limit;
  }

  if (filters.dateMode === 'after') {
    const limit = dayBoundary(filters.dateFrom, false);
    return limit === null || time >= limit;
  }

  const from = dayBoundary(filters.dateFrom, false);
  const to = dayBoundary(filters.dateTo, true);
  return (from === null || time >= from) && (to === null || time <= to);
};

const matchesAttachment = (message: Message, mode: AttachmentMode) => {
  const attachments = message.attachments ?? [];
  switch (mode) {
    case 'has':
      return attachments.length > 0;
    case 'none':
      return attachments.length === 0;
    case 'images':
      return attachments.some(isImage);
    case 'videos':
      return attachments.some(isVideo);
    case 'files':
      return attachments.some(isOtherFile);
    default:
      return true;
  }
};

export const countActiveFilters = (filters: MessageFilters) =>
  (filters.dateMode === 'any' ? 0 : 1) + (filters.attachment === 'any' ? 0 : 1);

export const applyFilters = (messages: Message[], filters: MessageFilters) => {
  if (countActiveFilters(filters) === 0) return messages;
  return messages.filter(
    message => matchesDate(message, filters) && matchesAttachment(message, filters.attachment)
  );
};
