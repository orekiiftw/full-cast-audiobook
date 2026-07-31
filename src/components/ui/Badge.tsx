import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "gold" | "emerald" | "cyan" | "purple" | "red";
  pulse?: boolean;
  className?: string;
}

const tones = {
  neutral: "bg-cinema-800/90 text-cinema-300 border-white/[0.06]",
  gold: "bg-gold-950/70 text-gold-300 border-gold-700/30",
  emerald: "bg-emerald-950/60 text-emerald-300 border-emerald-800/40",
  cyan: "bg-sky-950/50 text-sky-300 border-sky-800/40",
  purple: "bg-violet-950/50 text-violet-300 border-violet-800/40",
  red: "bg-red-950/50 text-red-300 border-red-900/40",
};

export function Badge({ children, tone = "neutral", pulse = false, className = "" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
        tones[tone],
        className,
      ].join(" ")}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
