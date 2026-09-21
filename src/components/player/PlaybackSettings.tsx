const SLEEP_OPTIONS = [
  { label: "Off", seconds: null as number | null },
  { label: "15 min", seconds: 900 },
  { label: "30 min", seconds: 1800 },
  { label: "45 min", seconds: 2700 },
  { label: "1 hr", seconds: 3600 },
];

const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

const SELECT_CLASS =
  "bg-cinema-950/80 border border-white/[0.08] text-xs px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-gold-500/50 text-cinema-200";

interface PlaybackSettingsProps {
  playbackSpeed: number;
  onSpeedChange: (speed: number) => void;
  sleepPreset: number | null;
  sleepTimeLeft: number | null;
  onSleepChange: (value: string) => void;
}

export function PlaybackSettings({ playbackSpeed, onSpeedChange, sleepPreset, sleepTimeLeft, onSleepChange }: PlaybackSettingsProps) {
  return (
    <div className="flex items-center gap-5">
      <div className="flex items-center gap-2">
        <span className="label-caps">Speed</span>
        <select value={playbackSpeed} onChange={(event) => onSpeedChange(parseFloat(event.target.value))} className={SELECT_CLASS}>
          {PLAYBACK_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}x
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="label-caps">Sleep</span>
        <select
          value={sleepPreset === null ? "" : String(sleepPreset)}
          onChange={(event) => onSleepChange(event.target.value)}
          className={SELECT_CLASS}
        >
          {SLEEP_OPTIONS.map((option) => (
            <option key={option.label} value={option.seconds === null ? "" : String(option.seconds)}>
              {option.label}
            </option>
          ))}
        </select>
        {sleepTimeLeft !== null && (
          <span className="text-[10px] font-mono text-gold-400 tabular-nums">
            {Math.floor(sleepTimeLeft / 60)}m {sleepTimeLeft % 60}s
          </span>
        )}
      </div>
    </div>
  );
}
