import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";

interface EmptyStateProps {
  title: string;
  description: ReactNode;
  icon?: IconName;
  art?: ReactNode;
  eyebrow?: string;
  tone?: "neutral" | "danger";
  actions?: ReactNode;
  children?: ReactNode;
  headingLevel?: "h1" | "h2";
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  art,
  eyebrow,
  tone = "neutral",
  actions,
  children,
  headingLevel = "h2",
  className = "",
}: EmptyStateProps) {
  const Heading = headingLevel;

  return (
    <div
      className={`relative isolate overflow-hidden rounded-stage border border-line-hairline bg-surface-1 px-5 py-12 text-center shadow-e-1 sm:px-10 sm:py-16 ${className}`}
    >
      {tone === "neutral" && <div className="atmosphere -z-10" aria-hidden="true" />}
      {art ??
        (icon && (
          <span
            aria-hidden="true"
            className={`mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-tile border shadow-e-1 ${
              tone === "danger" ? "border-danger-400/30 bg-danger-500/10 text-danger-300" : "border-line-strong bg-surface-3 text-gold-300"
            }`}
          >
            <Icon name={icon} size={24} />
          </span>
        ))}
      {eyebrow && <p className="eyebrow mb-2 text-gold-400">{eyebrow}</p>}
      <Heading className="text-balance font-serif text-display-md font-medium text-ink-primary">{title}</Heading>
      <p className="mx-auto mt-3 max-w-md text-pretty text-body text-ink-secondary">{description}</p>
      {children && <div className="mx-auto mt-8 max-w-md">{children}</div>}
      {actions && <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
    </div>
  );
}
