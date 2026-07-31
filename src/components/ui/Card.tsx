import type { ReactNode, MouseEvent } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  isInteractive?: boolean;
}

export function Card({ children, className = "", onClick, isInteractive = false }: CardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e as unknown as MouseEvent<HTMLDivElement>);
              }
            }
          : undefined
      }
      className={[
        "rounded-2xl border border-white/[0.06] bg-cinema-900/50 backdrop-blur-sm shadow-card",
        isInteractive &&
          "transition-all duration-300 ease-out-expo hover:border-white/[0.1] hover:bg-cinema-850/70 hover:shadow-elevated",
        onClick && isInteractive && "cursor-pointer",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
