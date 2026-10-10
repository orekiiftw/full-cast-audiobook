import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "gold" | "emerald" | "cyan" | "purple" | "red" | "warning";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line-strong bg-surface-3 text-ink-secondary",
  gold: "border-gold-400/30 bg-gold-500/10 text-gold-300",
  emerald: "border-success-400/30 bg-success-500/10 text-success-300",
  cyan: "border-info-400/30 bg-info-500/10 text-info-300",
  purple: "border-studio-400/30 bg-studio-500/10 text-studio-300",
  red: "border-danger-400/35 bg-danger-500/10 text-danger-300",
  warning: "border-warning-400/30 bg-warning-500/10 text-warning-300",
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  pulse?: boolean;
  className?: string;
}

export function Badge({ children, tone = "neutral", pulse = false, className = "" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-micro font-semibold uppercase",
        TONES[tone],
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${pulse ? "animate-breathe" : ""}`} />
      <span className="truncate">{children}</span>
    </span>
  );
}
