export type DateMode = 'any' | 'before' | 'after' | 'between';
export type AttachmentMode = 'any' | 'has' | 'none' | 'images' | 'videos' | 'audio' | 'files';

export interface MessageFilters {
  dateMode: DateMode;
  dateFrom: string;
  dateTo: string;
  attachment: AttachmentMode;
}

export interface BackendFilter {
  since: number | null;
  until: number | null;
  attachment: AttachmentMode | null;
}

export const EMPTY_FILTERS: MessageFilters = {
  dateMode: 'any',
  dateFrom: '',
  dateTo: '',
  attachment: 'any',
};

const localDaySeconds = (value: string, endOfDay: boolean) => {
  if (!value) return null;
  const time = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`).getTime();
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
};

export const countActiveFilters = (filters: MessageFilters) =>
  (filters.dateMode === 'any' ? 0 : 1) + (filters.attachment === 'any' ? 0 : 1);

export const toBackendFilter = (filters: MessageFilters): BackendFilter | null => {
  const { dateMode, dateFrom, dateTo } = filters;
  const since = dateMode === 'after' || dateMode === 'between' ? localDaySeconds(dateFrom, false) : null;
  const until =
    dateMode === 'before'
      ? localDaySeconds(dateFrom, true)
      : dateMode === 'between'
      ? localDaySeconds(dateTo, true)
      : null;
  const attachment = filters.attachment === 'any' ? null : filters.attachment;

  return since === null && until === null && attachment === null ? null : { since, until, attachment };
};
