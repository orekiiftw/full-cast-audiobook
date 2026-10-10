import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-gold-300 text-ink-inverse shadow-accent-press enabled:hover:bg-gold-200 enabled:hover:shadow-accent-lift",
  secondary:
    "border border-line-strong bg-surface-3 text-ink-primary shadow-e-1 enabled:hover:border-line-control enabled:hover:bg-surface-4",
  ghost: "text-ink-secondary enabled:hover:bg-surface-3 enabled:hover:text-ink-primary",
  danger: "border border-danger-400/35 bg-danger-500/10 text-danger-300 enabled:hover:border-danger-400/70 enabled:hover:bg-danger-500/20",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-10 gap-1.5 px-4 text-caption",
  md: "h-11 gap-2 px-5 text-body",
  lg: "h-12 gap-2 px-6 text-body-lg",
};

const SPINNER_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  isLoading = false,
  children,
  className = "",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const inactive = !!disabled && !isLoading;

  return (
    <button
      type={type}
      className={[
        "touch-target inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-semibold tracking-tight",
        "transition duration-fast ease-standard enabled:active:translate-y-px",
        VARIANTS[variant],
        SIZES[size],
        inactive ? "cursor-not-allowed opacity-50 shadow-none" : "",
        isLoading ? "cursor-progress" : "",
        className,
      ].join(" ")}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading && <Spinner size={SPINNER_SIZE[size]} />}
      {children}
    </button>
  );
}
