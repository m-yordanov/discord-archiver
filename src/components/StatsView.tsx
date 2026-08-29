import { useMemo, useState, useRef } from 'react';
import { Segmented } from './Segmented';
import {
  ChannelStats,
  Granularity,
  PackageStats,
  axisTicks,
  bucketBy,
  foldHours,
  formatCount,
  formatHourFull,
  formatPeriod,
  formatTick,
  isDirectMessage,
  mergeHours,
  totalPeriods,
} from '../stats';

type Scope = 'dms' | 'channels' | 'both';

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Daily' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
];

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'dms', label: 'Direct messages' },
  { value: 'channels', label: 'Channels' },
  { value: 'both', label: 'Both' },
];

interface TileProps {
  value: string;
  label: string;
}

function Tile({ value, label }: TileProps) {
  return (
    <div className="bg-dc-darker rounded-lg px-4 py-3 border border-dc-input/20">
      <div className="text-xl text-white font-medium leading-tight">{value}</div>
      <div className="text-xs text-dc-text-muted mt-0.5">{label}</div>
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}

function SectionHeader({ title, hint, children }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div>
        <div className="text-sm text-dc-text font-medium">{title}</div>
        {hint && <div className="text-xs text-dc-text-muted mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function buildSmoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x},${coords[0].y}`;
  if (coords.length === 2) return `M ${coords[0].x},${coords[0].y} L ${coords[1].x},${coords[1].y}`;

  let path = `M ${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return path;
}

interface StatsViewProps {
  stats: PackageStats | null;
  loading: boolean;
  error: string | null;
  onOpenChannel: (channel: ChannelStats) => void;
}

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 200;

export function StatsView({ stats, loading, error, onOpenChannel }: StatsViewProps) {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [scope, setScope] = useState<Scope>('both');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);

  const allHours = useMemo(() => (stats ? mergeHours(stats.channels) : []), [stats]);
  const folded = useMemo(() => foldHours(allHours), [allHours]);
  const points = useMemo(() => bucketBy(allHours, granularity), [allHours, granularity]);
  const periodCount = useMemo(
    () => totalPeriods(allHours, granularity),
    [allHours, granularity]
  );

  const ranked = useMemo(() => {
    if (!stats) return [];
    const matches = (channel: ChannelStats) =>
      scope === 'both' ||
      (scope === 'dms' ? isDirectMessage(channel) : !isDirectMessage(channel));

    return stats.channels
      .filter(matches)
      .slice()
      .sort((a, b) => b.message_count - a.message_count)
      .slice(0, 10);
  }, [stats, scope]);

  const maxPoint = Math.max(...points.map(p => p.count), 1);
  const ticks = axisTicks(maxPoint);
  const axisMax = ticks[ticks.length - 1] || 1;
  const maxRanked = Math.max(...ranked.map(c => c.message_count), 1);

  const maxByHour = Math.max(...folded.byHour, 1);
  const maxByWeekday = Math.max(...folded.byWeekday, 1);

  const shown = points.length;
  const windowLabel =
    shown === 0
      ? ''
      : shown < periodCount
        ? `Showing the most recent ${shown.toLocaleString()} of ${periodCount.toLocaleString()}`
        : `${formatPeriod(points[0].start, granularity)} – ${formatPeriod(points[shown - 1].start, granularity)}`;

  const tickEvery = Math.max(1, Math.ceil(shown / 8));

  const coords = useMemo(() => {
    if (points.length === 0) return [];
    if (points.length === 1) {
      return [{ x: SVG_WIDTH / 2, y: SVG_HEIGHT - (points[0].count / axisMax) * (SVG_HEIGHT - 16) - 8 }];
    }
    return points.map((p, index) => {
      const x = (index / (points.length - 1)) * SVG_WIDTH;
      const y = SVG_HEIGHT - (p.count / axisMax) * (SVG_HEIGHT - 20) - 10;
      return { x, y };
    });
  }, [points, axisMax]);

  const { linePath, areaPath } = useMemo(() => {
    if (coords.length === 0) return { linePath: '', areaPath: '' };
    const line = buildSmoothPath(coords);
    const area = `${line} L ${coords[coords.length - 1].x.toFixed(2)},${SVG_HEIGHT} L ${coords[0].x.toFixed(2)},${SVG_HEIGHT} Z`;
    return { linePath: line, areaPath: area };
  }, [coords]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartContainerRef.current || points.length === 0) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const relativeX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const rawIdx = (relativeX / rect.width) * (points.length - 1);
    const nearestIdx = Math.round(rawIdx);
    setHoveredIdx(Math.max(0, Math.min(points.length - 1, nearestIdx)));
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
  };

  if (loading) {
    return (
      <div className="flex-1 bg-dc-darkest flex items-center justify-center text-dc-text-muted">
        Reading the archive…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 bg-dc-darkest flex flex-col items-center justify-center gap-2 text-dc-text-muted">
        <span className="text-2xl">⚠️</span>
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  if (!stats || stats.total_messages === 0) {
    return (
      <div className="flex-1 bg-dc-darkest flex items-center justify-center text-dc-text-muted">
        Nothing to summarise in this package.
      </div>
    );
  }

  const range =
    folded.first && folded.last
      ? `${folded.first.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} – ${folded.last.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
      : '';

  const activeHoverPoint = hoveredIdx !== null && points[hoveredIdx] ? points[hoveredIdx] : null;
  const activeHoverCoord = hoveredIdx !== null && coords[hoveredIdx] ? coords[hoveredIdx] : null;

  return (
    <div className="flex-1 bg-dc-darkest flex flex-col min-w-0 h-full select-none">
      <div className="h-12 flex items-center justify-between px-6 border-b border-dc-dark shrink-0">
        <span className="font-bold text-white">Insights</span>
        <span className="text-sm text-dc-text-muted">{range}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
        <div className="max-w-[1040px]">
          <div className="flex items-baseline gap-3 mb-5">
            <span className="text-5xl text-white font-medium leading-none">
              {stats.total_messages.toLocaleString()}
            </span>
            <span className="text-sm text-dc-text-muted">messages you sent</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <Tile value={stats.channels.length.toLocaleString()} label="conversations" />
            <Tile value={stats.server_count.toLocaleString()} label="servers" />
            <Tile value={folded.activeDays.toLocaleString()} label="active days" />
            <Tile
              value={folded.busiestDay ? folded.busiestDay.count.toLocaleString() : '0'}
              label={
                folded.busiestDay
                  ? `busiest day, ${folded.busiestDay.date.toLocaleDateString()}`
                  : 'busiest day'
              }
            />
          </div>

          <div className="mb-8">
            <SectionHeader title="Activity" hint={windowLabel}>
              <Segmented options={GRANULARITIES} value={granularity} onChange={setGranularity} />
            </SectionHeader>

            <div className="relative h-56 bg-dc-darker/60 rounded-xl p-4 border border-dc-input/20">
              {ticks.map(tick => (
                <div
                  key={tick}
                  className="absolute inset-x-4 h-0 flex items-center pointer-events-none"
                  style={{ bottom: `${((tick / axisMax) * (SVG_HEIGHT - 20) + 10) * (100 / SVG_HEIGHT)}%` }}
                >
                  <span className="w-10 pr-2 text-right text-[10px] text-dc-text-muted shrink-0">
                    {formatCount(tick)}
                  </span>
                  <div className="flex-1 border-t border-dc-input/30" />
                </div>
              ))}

              <div
                ref={chartContainerRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className="absolute inset-y-4 left-14 right-4 cursor-crosshair"
              >
                <svg
                  viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                  preserveAspectRatio="none"
                  className="w-full h-full overflow-visible"
                >
                  <defs>
                    <linearGradient id="activityWaveGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5865f2" stopOpacity="0.5" />
                      <stop offset="50%" stopColor="#5865f2" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#5865f2" stopOpacity="0.0" />
                    </linearGradient>
                    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {areaPath && (
                    <path
                      d={areaPath}
                      fill="url(#activityWaveGradient)"
                      className="transition-all duration-300"
                    />
                  )}

                  {linePath && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#5865f2"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="transition-all duration-300"
                    />
                  )}

                  {activeHoverCoord && (
                    <g>
                      <line
                        x1={activeHoverCoord.x}
                        y1="0"
                        x2={activeHoverCoord.x}
                        y2={SVG_HEIGHT}
                        stroke="#ffffff"
                        strokeOpacity="0.3"
                        strokeDasharray="3 3"
                        strokeWidth="1.5"
                      />
                      <circle
                        cx={activeHoverCoord.x}
                        cy={activeHoverCoord.y}
                        r="6"
                        fill="#5865f2"
                        stroke="#ffffff"
                        strokeWidth="2.5"
                      />
                    </g>
                  )}
                </svg>

                {activeHoverPoint && activeHoverCoord && (
                  <div
                    className="absolute pointer-events-none z-30 transform -translate-x-1/2 -translate-y-full mb-3"
                    style={{
                      left: `${(activeHoverCoord.x / SVG_WIDTH) * 100}%`,
                      top: `${(activeHoverCoord.y / SVG_HEIGHT) * 100}%`,
                    }}
                  >
                    <div className="bg-[#111214]/95 text-white border border-[#202225] px-3 py-2 rounded-lg shadow-2xl backdrop-blur-sm whitespace-nowrap">
                      <div className="text-[11px] text-dc-text-muted font-medium">
                        {formatPeriod(activeHoverPoint.start, granularity)}
                      </div>
                      <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#5865f2]" />
                        <span>{activeHoverPoint.count.toLocaleString()} messages</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-[2px] mt-2 ml-14 mr-4">
              {points.map((point, index) => (
                <div
                  key={point.start.getTime()}
                  className="flex-1 min-w-[2px] text-[10px] text-dc-text-muted whitespace-nowrap"
                >
                  {index % tickEvery === 0 ? formatTick(point.start, granularity) : ''}
                </div>
              ))}
            </div>
          </div>

          <div className="mb-8">
            <SectionHeader title="When you message" hint="Local time activity patterns across all conversations" />

            <div className="bg-dc-darker rounded-lg p-4 mb-4 border border-dc-input/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <span className="text-3xl p-2 bg-dc-darkest rounded-lg">{folded.habit.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-white">{folded.habit.title}</span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-dc-accent/20 text-dc-accent border border-dc-accent/30">
                      Rhythm Profile
                    </span>
                  </div>
                  <div className="text-xs text-dc-text-muted mt-0.5">
                    {folded.habit.description}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-dc-text shrink-0">
                {folded.peakHour !== null && (
                  <div className="bg-dc-darkest px-3 py-2 rounded border border-dc-input/40 text-center min-w-[90px]">
                    <div className="text-[10px] text-dc-text-muted">Peak Hour</div>
                    <div className="font-semibold text-white text-xs mt-0.5">{formatHourFull(folded.peakHour)}</div>
                  </div>
                )}
                {folded.peakWeekday !== null && (
                  <div className="bg-dc-darkest px-3 py-2 rounded border border-dc-input/40 text-center min-w-[90px]">
                    <div className="text-[10px] text-dc-text-muted">Peak Day</div>
                    <div className="font-semibold text-white text-xs mt-0.5">{WEEKDAYS_FULL[folded.peakWeekday]}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-dc-darker rounded-lg p-4 border border-dc-input/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-white">Daily Rhythm</span>
                  </div>
                  <div className="h-32 flex items-end gap-1 pt-2 pb-1">
                    {folded.byHour.map((count, hour) => {
                      const isPeak = hour === folded.peakHour;
                      const percent = folded.totalMessages > 0 ? ((count / folded.totalMessages) * 100).toFixed(1) : '0';
                      const heightPercent = Math.max((count / maxByHour) * 100, count > 0 ? 3 : 0);
                      return (
                        <div
                          key={hour}
                          className="flex-1 flex flex-col items-center justify-end h-full group relative cursor-pointer"
                          title={`${formatHourFull(hour)} — ${count.toLocaleString()} messages (${percent}%)`}
                        >
                          <div
                            className={`w-full rounded-t-sm transition-all ${
                              isPeak ? 'bg-[#5865f2] ring-1 ring-white/40' : 'bg-dc-accent group-hover:bg-[#7983f5]'
                            }`}
                            style={{
                              height: `${heightPercent}%`,
                              opacity: isPeak ? 1 : 0.35 + (count / maxByHour) * 0.65,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-dc-text-muted mt-1 px-0.5">
                    <span>12 AM</span>
                    <span>4 AM</span>
                    <span>8 AM</span>
                    <span>12 PM</span>
                    <span>4 PM</span>
                    <span>8 PM</span>
                    <span>11 PM</span>
                  </div>
                </div>
                <div className="text-[11px] text-dc-text-muted mt-3 pt-2 border-t border-dc-input/20 flex justify-between items-center">
                  <span>Quiet hours: 3 AM – 7 AM</span>
                  {folded.peakHour !== null && (
                    <span className="text-white font-medium">
                      Busiest at {formatHourFull(folded.peakHour)} ({((folded.byHour[folded.peakHour] / (folded.totalMessages || 1)) * 100).toFixed(1)}%)
                    </span>
                  )}
                </div>
              </div>

              <div className="bg-dc-darker rounded-lg p-4 border border-dc-input/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-white">Day of the Week</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {folded.byWeekday.map((count, index) => {
                      const isPeak = index === folded.peakWeekday;
                      const percent = folded.totalMessages > 0 ? ((count / folded.totalMessages) * 100).toFixed(1) : '0';
                      const widthPercent = (count / maxByWeekday) * 100;
                      return (
                        <div key={WEEKDAYS_SHORT[index]} className="flex items-center gap-2 text-xs">
                          <span className={`w-8 shrink-0 text-left font-medium ${isPeak ? 'text-white' : 'text-dc-text-muted'}`}>
                            {WEEKDAYS_SHORT[index]}
                          </span>
                          <div className="flex-1 bg-dc-darkest rounded-full h-3 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isPeak ? 'bg-[#5865f2]' : 'bg-dc-accent/80'
                              }`}
                              style={{ width: `${Math.max(widthPercent, 1)}%` }}
                            />
                          </div>
                          <span className="w-20 shrink-0 text-right text-[11px] text-dc-text-muted">
                            {formatCount(count)} <span className="text-[10px] opacity-75">({percent}%)</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="text-[11px] text-dc-text-muted mt-3 pt-2 border-t border-dc-input/20 flex justify-between items-center">
                  <span>{folded.habit.weekdayPercent}% Weekdays</span>
                  <span>{folded.habit.weekendPercent}% Weekends</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <SectionHeader title="Most messaged" hint="Click to open the conversation">
              <Segmented options={SCOPES} value={scope} onChange={setScope} />
            </SectionHeader>

            {ranked.length === 0 ? (
              <div className="text-sm text-dc-text-muted py-4">
                No {scope === 'dms' ? 'direct messages' : 'server channels'} in this package.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {ranked.map((channel, rank) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => onOpenChannel(channel)}
                    className="flex items-center gap-3 group cursor-pointer text-left"
                  >
                    <span className="w-40 shrink-0 truncate text-sm text-dc-text group-hover:text-white transition-colors">
                      {isDirectMessage(channel) ? channel.name : `#${channel.name}`}
                    </span>
                    <span className="flex-1 bg-dc-darker rounded-r h-5">
                      <span
                        className="block h-5 bg-dc-accent rounded-r"
                        style={{
                          width: `${(channel.message_count / maxRanked) * 100}%`,
                          opacity: 1 - rank * 0.06,
                        }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-xs text-dc-text-muted text-right">
                      {channel.message_count.toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
