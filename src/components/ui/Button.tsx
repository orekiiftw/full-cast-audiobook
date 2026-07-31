import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  children: ReactNode;
}

const variants = {
  primary:
    "bg-gradient-to-b from-gold-400 to-gold-500 text-cinema-950 shadow-glow-sm hover:from-gold-300 hover:to-gold-400 hover:shadow-glow border border-gold-300/20",
  secondary:
    "bg-cinema-800/80 text-cinema-100 hover:bg-cinema-700 border border-white/[0.06] hover:border-white/10 shadow-sm",
  ghost: "text-cinema-300 hover:text-white hover:bg-white/[0.04]",
  danger:
    "bg-red-950/50 text-red-200 hover:bg-red-900/50 border border-red-900/40 hover:border-red-800/60",
};

const sizes = {
  sm: "px-3.5 py-1.5 text-xs rounded-lg",
  md: "px-5 py-2.5 text-sm rounded-xl",
  lg: "px-7 py-3 text-[15px] rounded-xl",
};

export function Button({
  variant = "secondary",
  size = "md",
  isLoading,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 font-semibold tracking-tight transition-all duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-cinema-950",
        "disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.98]",
        variants[variant],
        sizes[size],
        className,
      ].join(" ")}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
