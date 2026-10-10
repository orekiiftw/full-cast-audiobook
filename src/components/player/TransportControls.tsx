import { Icon, IconButton } from "../ui";

type TransportControlsVariant = "collapsed" | "expanded";

interface TransportControlsProps {
  variant: TransportControlsVariant;
  canGoPrev: boolean;
  canGoNext: boolean;
  goToPrev: () => void;
  goToNext: () => void;
  togglePlayPause: () => void;
  isPlaying: boolean;
}

export type PlayerTransportControls = Omit<TransportControlsProps, "variant">;

export function TransportControls({
  variant,
  canGoPrev,
  canGoNext,
  goToPrev,
  goToNext,
  togglePlayPause,
  isPlaying,
}: TransportControlsProps) {
  const expanded = variant === "expanded";

  return (
    <div className={`flex items-center ${expanded ? "gap-4 sm:gap-6" : "gap-1 sm:gap-2"}`}>
      <IconButton icon="skipBack" label="Previous segment" size={expanded ? "lg" : "md"} disabled={!canGoPrev} onClick={goToPrev} />
      <button
        type="button"
        onClick={togglePlayPause}
        aria-label={isPlaying ? "Pause" : "Play"}
        className={`flex shrink-0 items-center justify-center rounded-full bg-gold-300 text-ink-inverse shadow-accent-press transition duration-fast ease-standard hover:bg-gold-200 hover:shadow-accent-lift active:scale-95 ${
          expanded ? "h-16 w-16" : "h-12 w-12"
        }`}
      >
        <Icon name={isPlaying ? "pause" : "play"} size={expanded ? 26 : 20} className={isPlaying ? "" : "translate-x-px"} />
      </button>
      <IconButton icon="skipForward" label="Next segment" size={expanded ? "lg" : "md"} disabled={!canGoNext} onClick={goToNext} />
    </div>
  );
}
