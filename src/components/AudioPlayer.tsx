import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useResolvedUrl } from '../urlResolver';

interface AudioPlayerProps {
  src: string;
  isVoiceMessage?: boolean;
  fileName?: string;
  onLinkContextMenu?: (e: React.MouseEvent, url: string) => void;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const NUM_BARS = 40;

const formatDuration = (seconds: number) => {
  if (!seconds || Number.isNaN(seconds) || !Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const generateFallbackWaveform = (seedStr: string): number[] => {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash << 5) - hash + seedStr.charCodeAt(i);
    hash |= 0;
  }

  const bars: number[] = [];
  for (let i = 0; i < NUM_BARS; i++) {
    const angle1 = (i / NUM_BARS) * Math.PI * 4 + (hash % 10);
    const angle2 = (i / NUM_BARS) * Math.PI * 8 + ((hash >> 3) % 7);
    const envelope = Math.sin((i / NUM_BARS) * Math.PI);
    const wave = (Math.sin(angle1) * 0.4 + Math.cos(angle2) * 0.3 + 0.5) * envelope;
    const clamped = Math.max(0.18, Math.min(1.0, wave + 0.15));
    bars.push(clamped);
  }
  return bars;
};

export function AudioPlayer({
  src,
  isVoiceMessage = false,
  fileName,
  onLinkContextMenu,
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(() => generateFallbackWaveform(src));
  const [hasError, setHasError] = useState(false);

  const { resolvedUrl, reportError } = useResolvedUrl(src);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const playerIdRef = useRef<string>(`audio-${Math.random().toString(36).slice(2)}`);

  const currentSpeed = SPEED_OPTIONS[speedIndex];

  useEffect(() => {
    let isCancelled = false;

    const decodeWaveform = async () => {
      try {
        const response = await fetch(resolvedUrl);
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const audioCtx = new AudioCtx();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(channelData.length / NUM_BARS);
        const sampled: number[] = [];

        for (let i = 0; i < NUM_BARS; i++) {
          let sum = 0;
          const start = i * blockSize;
          const end = Math.min(start + blockSize, channelData.length);
          for (let j = start; j < end; j++) {
            sum += Math.abs(channelData[j]);
          }
          sampled.push(sum / (end - start || 1));
        }

        const maxVal = Math.max(...sampled, 0.01);
        const normalized = sampled.map(v => Math.max(0.18, Math.min(1.0, v / maxVal)));
        if (!isCancelled) {
          setWaveform(normalized);
        }
        await audioCtx.close();
      } catch {
      }
    };

    decodeWaveform();

    return () => {
      isCancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const handleGlobalPlay = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail !== playerIdRef.current && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    };

    window.addEventListener('discord-audio-play', handleGlobalPlay);
    return () => {
      window.removeEventListener('discord-audio-play', handleGlobalPlay);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      window.dispatchEvent(
        new CustomEvent('discord-audio-play', { detail: playerIdRef.current })
      );
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setHasError(true));
    }
  };

  const handleTimeUpdate = () => {
    if (!isScrubbing && audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      audioRef.current.playbackRate = currentSpeed;
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  const cycleSpeed = () => {
    const nextIdx = (speedIndex + 1) % SPEED_OPTIONS.length;
    setSpeedIndex(nextIdx);
    const nextSpeed = SPEED_OPTIONS[nextIdx];
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!waveformRef.current || !audioRef.current || !duration) return;
      const rect = waveformRef.current.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = clickX / rect.width;
      const targetTime = pct * duration;
      setCurrentTime(targetTime);
      audioRef.current.currentTime = targetTime;
    },
    [duration]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsScrubbing(true);
    seekFromClientX(e.clientX);

    const handleMouseMove = (moveEvt: MouseEvent) => {
      seekFromClientX(moveEvt.clientX);
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const progressPercent = useMemo(() => {
    if (!duration) return 0;
    return Math.min(100, (currentTime / duration) * 100);
  }, [currentTime, duration]);

  const displayName = useMemo(() => {
    if (isVoiceMessage) return 'Voice Message';
    if (fileName) return fileName;
    const parts = src.split('?')[0].split('/');
    return parts[parts.length - 1] || 'Audio';
  }, [isVoiceMessage, fileName, src]);

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openUrl(src).catch(() => window.open(src, '_blank'));
  };

  return (
    <div className="bg-dc-darker hover:bg-dc-hover transition-colors rounded-2xl p-3 border border-dc-input/40 max-w-md w-full select-none shadow-sm flex flex-col gap-2">
      <audio
        ref={audioRef}
        src={resolvedUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={() => {
          reportError();
          setHasError(true);
        }}
      />

      <div className="flex items-center justify-between text-xs text-dc-text-muted px-1">
        <div className="flex items-center gap-1.5 truncate">
          <span className="text-sm">{isVoiceMessage ? '🎙️' : '🎵'}</span>
          <span className="font-semibold text-white truncate max-w-[200px]" title={displayName}>
            {displayName}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={cycleSpeed}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-dc-dark hover:bg-dc-hover text-dc-text hover:text-white transition-colors border border-dc-input/30 cursor-pointer"
            title="Change playback speed (0.75x, 1x, 1.25x, 1.5x, 2x)"
          >
            {currentSpeed}x
          </button>

          <button
            type="button"
            onClick={handleOpenExternal}
            onContextMenu={e => {
              if (onLinkContextMenu) {
                e.preventDefault();
                e.stopPropagation();
                onLinkContextMenu(e, src);
              }
            }}
            className="text-dc-text-muted hover:text-white text-xs cursor-pointer p-0.5"
            title="Open or download audio file"
          >
            🔗
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={hasError}
          className="w-10 h-10 rounded-full bg-[#5865F2] hover:bg-[#4752C4] text-white flex items-center justify-center shrink-0 shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-50 cursor-pointer"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <rect x="6" y="5" width="4" height="14" rx="1.5" />
              <rect x="14" y="5" width="4" height="14" rx="1.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4 fill-current translate-x-0.5" viewBox="0 0 24 24">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>

        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div
            ref={waveformRef}
            onMouseDown={handleMouseDown}
            className="h-8 flex items-center gap-[2.5px] cursor-pointer group py-1 relative"
            title="Click or drag to seek"
          >
            {waveform.map((heightNorm, i) => {
              const barProgress = (i / NUM_BARS) * 100;
              const isFilled = barProgress <= progressPercent;
              const barHeightPx = Math.max(5, Math.round(heightNorm * 26));

              return (
                <div
                  key={i}
                  className="flex-1 flex items-center justify-center h-full pointer-events-none"
                >
                  <div
                    className={`w-full rounded-full transition-colors ${
                      isFilled
                        ? 'bg-white'
                        : 'bg-[#4e5058] group-hover:bg-[#5c5e66]'
                    }`}
                    style={{ height: `${barHeightPx}px` }}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex justify-between items-center text-[11px] text-dc-text-muted px-0.5">
            <span>{formatDuration(currentTime)}</span>
            <span>{hasError ? 'Error loading' : formatDuration(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
