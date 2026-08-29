export interface HourBucket {
  hour: number;
  count: number;
}

export interface ChannelStats {
  id: string;
  name: string;
  channel_type: string;
  folder_name: string;
  message_count: number;
  hours: HourBucket[];
}

export interface PackageStats {
  total_messages: number;
  username: string;
  server_count: number;
  channels: ChannelStats[];
}

export type Granularity = 'hour' | 'day' | 'month' | 'year';

export interface TimePoint {
  start: Date;
  count: number;
}

export interface HabitSummary {
  icon: string;
  title: string;
  description: string;
  nightPercent: number;
  weekendPercent: number;
  weekdayPercent: number;
}

export interface FoldedStats {
  weekdayHour: number[][];
  byHour: number[];
  byWeekday: number[];
  totalMessages: number;
  activeDays: number;
  busiestDay: { date: Date; count: number } | null;
  peakHour: number | null;
  peakWeekday: number | null;
  habit: HabitSummary;
  first: Date | null;
  last: Date | null;
}

export const MAX_POINTS: Record<Granularity, number> = {
  hour: 168,
  day: 240,
  month: 240,
  year: 60,
};

const pad = (n: number) => String(n).padStart(2, '0');

export const mergeHours = (channels: ChannelStats[]): HourBucket[] => {
  const totals = new Map<number, number>();
  for (const channel of channels) {
    for (const bucket of channel.hours) {
      totals.set(bucket.hour, (totals.get(bucket.hour) ?? 0) + bucket.count);
    }
  }
  return [...totals]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour);
};

const startOfPeriod = (at: Date, granularity: Granularity): Date => {
  switch (granularity) {
    case 'hour':
      return new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours());
    case 'day':
      return new Date(at.getFullYear(), at.getMonth(), at.getDate());
    case 'month':
      return new Date(at.getFullYear(), at.getMonth(), 1);
    case 'year':
      return new Date(at.getFullYear(), 0, 1);
  }
};

const step = (at: Date, granularity: Granularity, direction: number): Date => {
  const next = new Date(at);
  switch (granularity) {
    case 'hour':
      next.setHours(next.getHours() + direction);
      break;
    case 'day':
      next.setDate(next.getDate() + direction);
      break;
    case 'month':
      next.setMonth(next.getMonth() + direction);
      break;
    case 'year':
      next.setFullYear(next.getFullYear() + direction);
      break;
  }
  return next;
};

export const bucketBy = (hours: HourBucket[], granularity: Granularity): TimePoint[] => {
  if (hours.length === 0) return [];

  const totals = new Map<number, number>();
  let earliest = Infinity;
  let latest = -Infinity;

  for (const bucket of hours) {
    const start = startOfPeriod(new Date(bucket.hour * 3600 * 1000), granularity).getTime();
    totals.set(start, (totals.get(start) ?? 0) + bucket.count);
    if (start < earliest) earliest = start;
    if (start > latest) latest = start;
  }

  const limit = MAX_POINTS[granularity];
  const points: TimePoint[] = [];
  let cursor = new Date(latest);

  while (points.length < limit && cursor.getTime() >= earliest) {
    points.push({ start: new Date(cursor), count: totals.get(cursor.getTime()) ?? 0 });
    cursor = step(cursor, granularity, -1);
  }

  return points.reverse();
};

export const totalPeriods = (hours: HourBucket[], granularity: Granularity): number => {
  if (hours.length === 0) return 0;
  const seen = new Set<number>();
  for (const bucket of hours) {
    seen.add(startOfPeriod(new Date(bucket.hour * 3600 * 1000), granularity).getTime());
  }
  const times = [...seen];
  let count = 0;
  let cursor = new Date(Math.min(...times));
  const end = Math.max(...times);
  while (cursor.getTime() <= end) {
    count += 1;
    cursor = step(cursor, granularity, 1);
  }
  return count;
};

export const foldHours = (hours: HourBucket[]): FoldedStats => {
  const weekdayHour: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const byDay = new Map<string, { date: Date; count: number }>();
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);

  let first: Date | null = null;
  let last: Date | null = null;
  let totalMessages = 0;

  for (const bucket of hours) {
    const at = new Date(bucket.hour * 3600 * 1000);
    if (first === null || at < first) first = at;
    if (last === null || at > last) last = at;

    const weekdayIndex = (at.getDay() + 6) % 7;
    const hourIndex = at.getHours();

    weekdayHour[weekdayIndex][hourIndex] += bucket.count;
    byHour[hourIndex] += bucket.count;
    byWeekday[weekdayIndex] += bucket.count;
    totalMessages += bucket.count;

    const dayKey = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    const day = byDay.get(dayKey);
    if (day) {
      day.count += bucket.count;
    } else {
      byDay.set(dayKey, {
        date: new Date(at.getFullYear(), at.getMonth(), at.getDate()),
        count: bucket.count,
      });
    }
  }

  let busiestDay: { date: Date; count: number } | null = null;
  for (const day of byDay.values()) {
    if (!busiestDay || day.count > busiestDay.count) busiestDay = day;
  }

  const maxHourCount = Math.max(...byHour, 0);
  const peakHour = maxHourCount > 0 ? byHour.indexOf(maxHourCount) : null;

  const maxWeekdayCount = Math.max(...byWeekday, 0);
  const peakWeekday = maxWeekdayCount > 0 ? byWeekday.indexOf(maxWeekdayCount) : null;

  let nightCount = 0;
  for (const h of [22, 23, 0, 1, 2, 3, 4]) {
    nightCount += byHour[h];
  }

  let morningCount = 0;
  for (let h = 5; h <= 11; h++) {
    morningCount += byHour[h];
  }

  let eveningCount = 0;
  for (let h = 17; h <= 21; h++) {
    eveningCount += byHour[h];
  }

  const weekendCount = byWeekday[5] + byWeekday[6];

  const nightPercent = totalMessages > 0 ? Math.round((nightCount / totalMessages) * 100) : 0;
  const morningPercent = totalMessages > 0 ? Math.round((morningCount / totalMessages) * 100) : 0;
  const eveningPercent = totalMessages > 0 ? Math.round((eveningCount / totalMessages) * 100) : 0;
  const weekendPercent = totalMessages > 0 ? Math.round((weekendCount / totalMessages) * 100) : 0;
  const weekdayPercent = 100 - weekendPercent;

  let habit: HabitSummary;

  if (nightPercent >= 32) {
    habit = {
      icon: '🦉',
      title: 'Night Owl',
      description: `${nightPercent}% of your messages are sent late at night (10 PM – 5 AM).`,
      nightPercent,
      weekendPercent,
      weekdayPercent,
    };
  } else if (morningPercent >= 28) {
    habit = {
      icon: '☀️',
      title: 'Early Bird',
      description: `${morningPercent}% of your messages are sent in the morning before noon.`,
      nightPercent,
      weekendPercent,
      weekdayPercent,
    };
  } else if (eveningPercent >= 38) {
    habit = {
      icon: '🌆',
      title: 'Evening Chatter',
      description: `${eveningPercent}% of your messages are sent during prime evening hours (5 PM – 10 PM).`,
      nightPercent,
      weekendPercent,
      weekdayPercent,
    };
  } else if (weekendPercent >= 38) {
    habit = {
      icon: '🎉',
      title: 'Weekend Warrior',
      description: `${weekendPercent}% of your messaging happens on Saturdays and Sundays.`,
      nightPercent,
      weekendPercent,
      weekdayPercent,
    };
  } else {
    habit = {
      icon: '⚡',
      title: 'Daytime Communicator',
      description: `${weekdayPercent}% of your messages are sent during regular daytime hours.`,
      nightPercent,
      weekendPercent,
      weekdayPercent,
    };
  }

  return {
    weekdayHour,
    byHour,
    byWeekday,
    totalMessages,
    activeDays: byDay.size,
    busiestDay,
    peakHour,
    peakWeekday,
    habit,
    first,
    last,
  };
};

export const isDirectMessage = (channel: ChannelStats) =>
  channel.channel_type === 'DM' || channel.channel_type === 'GROUP_DM';

export const formatHour = (hour: number) => {
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
};

export const formatHourFull = (hour: number) => {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
};

export const formatCount = (value: number): string => {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return String(Math.round(value));
};

export const axisTicks = (max: number, target = 4): number[] => {
  if (max <= 0) return [0];

  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const nice = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
  const stepSize = Math.max(1, nice * magnitude);
  const steps = Math.ceil(max / stepSize);

  return Array.from({ length: steps + 1 }, (_, index) => index * stepSize);
};

export const formatPeriod = (at: Date, granularity: Granularity): string => {
  switch (granularity) {
    case 'hour':
      return `${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${formatHour(at.getHours())}`;
    case 'day':
      return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    case 'month':
      return at.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'year':
      return String(at.getFullYear());
  }
};

export const formatTick = (at: Date, granularity: Granularity): string => {
  switch (granularity) {
    case 'hour':
      return formatHour(at.getHours());
    case 'day':
      return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'month':
      return at.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    case 'year':
      return String(at.getFullYear());
  }
};
