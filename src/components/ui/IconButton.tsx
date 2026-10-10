import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { Spinner } from "./Spinner";

type IconButtonVariant = "ghost" | "secondary" | "glass" | "danger";
type IconButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: "text-ink-secondary enabled:hover:bg-surface-3 enabled:hover:text-ink-primary",
  secondary:
    "border border-line-strong bg-surface-3 text-ink-primary shadow-e-1 enabled:hover:border-line-control enabled:hover:bg-surface-4",
  glass: "chrome-glass border border-line-strong text-ink-primary shadow-e-1 enabled:hover:border-line-control",
  danger: "text-ink-secondary enabled:hover:bg-danger-500/15 enabled:hover:text-danger-300",
};

const SIZES: Record<IconButtonSize, { box: string; icon: number }> = {
  sm: { box: "h-9 w-9", icon: 16 },
  md: { box: "h-11 w-11", icon: 18 },
  lg: { box: "h-12 w-12", icon: 20 },
};

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  isLoading?: boolean;
}

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  isLoading = false,
  className = "",
  disabled,
  type = "button",
  ...rest
}: IconButtonProps) {
  const scale = SIZES[size];

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={[
        "touch-target inline-flex shrink-0 items-center justify-center rounded-full transition duration-fast ease-standard enabled:active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-40",
        scale.box,
        VARIANTS[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {isLoading ? <Spinner size={scale.icon - 2} /> : <Icon name={icon} size={scale.icon} />}
    </button>
  );
}
