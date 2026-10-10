import { Icon, type IconName } from "../ui";
import { formatDuration } from "../../lib/format";

const SLEEP_OPTIONS = [
  { label: "Off", seconds: null as number | null },
  { label: "15 min", seconds: 900 },
  { label: "30 min", seconds: 1800 },
  { label: "45 min", seconds: 2700 },
  { label: "1 hr", seconds: 3600 },
];

const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

interface PlaybackSettingsProps {
  playbackSpeed: number;
  onSpeedChange: (speed: number) => void;
  sleepPreset: number | null;
  sleepTimeLeft: number | null;
  onSleepChange: (value: string) => void;
}

export function PlaybackSettings({ playbackSpeed, onSpeedChange, sleepPreset, sleepTimeLeft, onSleepChange }: PlaybackSettingsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
      <SettingSelect
        id="player-speed"
        label="Speed"
        icon="gauge"
        value={String(playbackSpeed)}
        onChange={(value) => onSpeedChange(parseFloat(value))}
        options={PLAYBACK_SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}×` }))}
      />

      <div className="flex items-center gap-2">
        <SettingSelect
          id="player-sleep"
          label="Sleep"
          icon="moon"
          value={sleepPreset === null ? "" : String(sleepPreset)}
          onChange={onSleepChange}
          options={SLEEP_OPTIONS.map((option) => ({
            value: option.seconds === null ? "" : String(option.seconds),
            label: option.label,
          }))}
        />
        {sleepTimeLeft !== null && (
          <span className="flex h-7 items-center rounded-full border border-line-accent bg-gold-500/10 px-2.5 font-mono text-caption tabular-nums text-gold-200">
            {formatDuration(sleepTimeLeft * 1000)}
            <span className="sr-only"> until playback stops</span>
          </span>
        )}
      </div>
    </div>
  );
}

interface SettingSelectProps {
  id: string;
  label: string;
  icon: IconName;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

function SettingSelect({ id, label, icon, value, onChange, options }: SettingSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="eyebrow flex items-center gap-1.5">
        <Icon name={icon} size={14} />
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 cursor-pointer sm:h-9 appearance-none rounded-full border border-line-strong bg-surface-2 pl-3.5 pr-8 font-mono text-caption tabular-nums text-ink-primary transition-colors duration-fast hover:border-line-control"
        >
          {options.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
      </div>
    </div>
  );
}
