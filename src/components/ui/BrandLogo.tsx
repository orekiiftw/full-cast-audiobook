import { Icon } from "./Icon";

type BrandLogoSize = "sm" | "md" | "lg";

const SIZES = {
  sm: { mark: "h-9 w-9", wordmark: "text-2xl", icon: 19 },
  md: { mark: "h-10 w-10", wordmark: "text-3xl", icon: 21 },
  lg: { mark: "h-12 w-12", wordmark: "text-4xl", icon: 25 },
};

interface BrandLogoProps {
  size?: BrandLogoSize;
  className?: string;
}

export function BrandLogo({ size = "sm", className = "" }: BrandLogoProps) {
  const scale = SIZES[size];
  return (
    <span className={`inline-flex items-center gap-2.5 shrink-0 ${className}`}>
      <span className={`${scale.mark} rounded-full border border-gold-300/30 text-gold-300 flex items-center justify-center`}>
        <Icon name="book" size={scale.icon} />
      </span>
      <span className={`font-serif ${scale.wordmark} tracking-tight text-cinema-100`}>
        narratea<span className="text-gold-300">.</span>
      </span>
    </span>
  );
}
