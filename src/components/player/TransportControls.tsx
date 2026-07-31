import { Icon } from "../ui/Icon";

export type TransportControlsVariant = "collapsed" | "expanded";

interface TransportControlsProps {
  variant: TransportControlsVariant;
  canGoPrev: boolean;
  canGoNext: boolean;
  goToPrev: () => void;
  goToNext: () => void;
  togglePlayPause: () => void;
  isPlaying: boolean;
  transportButton: string;
}

export function TransportControls({
  variant,
  canGoPrev,
  canGoNext,
  goToPrev,
  goToNext,
  togglePlayPause,
  isPlaying,
  transportButton,
}: TransportControlsProps) {
  const iconSize = variant === "collapsed" ? 20 : 22;
  const playBtnSize = variant === "collapsed" ? "w-12 h-12" : "w-14 h-14";
  const playBtnShadow = variant === "collapsed" ? "shadow-glow-sm" : "shadow-glow";

  return (
    <>
      <button disabled={!canGoPrev} onClick={goToPrev} className={transportButton} aria-label="Previous segment">
        <Icon name="skipBack" size={iconSize} />
      </button>
      <button
        onClick={togglePlayPause}
        className={`${playBtnSize} rounded-full bg-gradient-to-b from-gold-300 to-gold-500 text-cinema-950 flex items-center justify-center ${playBtnShadow} hover:scale-105 active:scale-95 transition-transform border border-gold-200/20`}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        <Icon name={isPlaying ? "pause" : "play"} size={iconSize} />
      </button>
      <button disabled={!canGoNext} onClick={goToNext} className={transportButton} aria-label="Next segment">
        <Icon name="skipForward" size={iconSize} />
      </button>
    </>
  );
}
