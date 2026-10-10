import { LevelMeter } from "./LevelMeter";

type BrandLogoSize = "sm" | "md" | "lg";

const SIZES = {
  sm: { mark: "h-8 w-8 rounded-control", glyph: 16, wordmark: "text-title-lg", meter: "h-3.5" },
  md: { mark: "h-10 w-10 rounded-control", glyph: 20, wordmark: "text-display-md", meter: "h-4" },
  lg: { mark: "h-12 w-12 rounded-tile", glyph: 24, wordmark: "text-display-lg", meter: "h-5" },
};

interface BrandLogoProps {
  size?: BrandLogoSize;
  className?: string;
  animated?: boolean;
  showWordmark?: boolean;
}

export function BrandLogo({ size = "sm", className = "", animated = false, showWordmark = true }: BrandLogoProps) {
  const scale = SIZES[size];
  return (
    <span className={`inline-flex shrink-0 items-center gap-2.5 ${className}`}>
      <span
        className={`${scale.mark} flex items-center justify-center border border-line-strong bg-surface-3 text-gold-300 shadow-e-1`}
        aria-hidden="true"
      >
        {animated ? <LevelMeter className={scale.meter} /> : <BrandGlyph size={scale.glyph} />}
      </span>
      {showWordmark && (
        <span className={`font-serif ${scale.wordmark} font-medium leading-none tracking-tight text-ink-primary`}>
          narratea<span className="text-gold-400">.</span>
        </span>
      )}
    </span>
  );
}

function BrandGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="3" y="7.5" width="2.25" height="5" rx="1.125" />
      <rect x="7" y="3.5" width="2.25" height="13" rx="1.125" />
      <rect x="11" y="5.5" width="2.25" height="9" rx="1.125" />
      <rect x="15" y="8.25" width="2.25" height="3.5" rx="1.125" />
    </svg>
  );
}
