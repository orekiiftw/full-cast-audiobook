import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";

type NoticeTone = "info" | "warning" | "danger" | "success" | "gold";

const TONES: Record<NoticeTone, { box: string; icon: string; glyph: IconName }> = {
  info: { box: "border-info-400/25 bg-info-500/10", icon: "text-info-300", glyph: "info" },
  warning: { box: "border-warning-400/30 bg-warning-500/10", icon: "text-warning-300", glyph: "alert" },
  danger: { box: "border-danger-400/35 bg-danger-500/10", icon: "text-danger-300", glyph: "alert" },
  success: { box: "border-success-400/25 bg-success-500/10", icon: "text-success-300", glyph: "checkCircle" },
  gold: { box: "border-gold-400/25 bg-gold-500/10", icon: "text-gold-300", glyph: "info" },
};

interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  role?: "alert" | "status";
  className?: string;
}

export function Notice({ tone = "info", title, children, icon, action, role, className = "" }: NoticeProps) {
  const palette = TONES[tone];
  return (
    <div role={role} className={`flex items-start gap-3 rounded-tile border px-3.5 py-3 ${palette.box} ${className}`}>
      <Icon name={icon ?? palette.glyph} size={18} className={`mt-px ${palette.icon}`} />
      <div className="min-w-0 flex-1 text-caption text-ink-secondary">
        {title && <p className="mb-0.5 font-semibold text-ink-primary">{title}</p>}
        <div className="break-words">{children}</div>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}
