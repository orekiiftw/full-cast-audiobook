import { Icon } from "./Icon";

type BrandLogoSize = "sm" | "md" | "lg";

const SIZES: Record<BrandLogoSize, { wrapper: string; icon: string; iconSize: number; wordmark: string }> = {
  sm: {
    wrapper: "w-9 h-9 rounded-2xl",
    icon: "text-cinema-950",
    iconSize: 16,
    wordmark: "text-[15px] tracking-[0.2em]",
  },
  md: {
    wrapper: "h-10 w-10 rounded-2xl",
    icon: "text-cinema-950",
    iconSize: 17,
    wordmark: "text-[15px] tracking-[0.22em]",
  },
  lg: {
    wrapper: "h-11 w-11 rounded-2xl",
    icon: "text-cinema-950",
    iconSize: 18,
    wordmark: "text-base tracking-[0.24em]",
  },
};

interface BrandLogoProps {
  size?: BrandLogoSize;
  className?: string;
}

/** Narratea badge + wordmark. Hover grow only activates inside a `group` parent. */
export function BrandLogo({ size = "sm", className = "" }: BrandLogoProps) {
  const s = SIZES[size];
  return (
    <span className={`flex items-center gap-3 shrink-0 ${className}`}>
      <span
        className={`${s.wrapper} bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 flex items-center justify-center shadow-glow-sm transition-transform duration-500 ease-out-expo group-hover:scale-105 group-hover:rotate-6`}
      >
        <Icon name="sparkle" size={s.iconSize} className={s.icon} />
      </span>
      <span className={`font-display ${s.wordmark} font-semibold uppercase text-gradient`}>
        Narratea
      </span>
    </span>
  );
}
