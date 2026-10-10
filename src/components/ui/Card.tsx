import type { ReactNode, MouseEvent, KeyboardEvent } from "react";

type Elevation = 0 | 1 | 2 | 3;

const ELEVATIONS: Record<Elevation, string> = {
  0: "border-line-hairline bg-surface-1",
  1: "border-line-hairline bg-surface-2 shadow-e-1",
  2: "border-line-strong bg-surface-2 shadow-e-2",
  3: "border-line-strong bg-surface-3 shadow-e-3",
};

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;
  isInteractive?: boolean;
  elevation?: Elevation;
}

export function Card({ children, className = "", onClick, isInteractive = false, elevation = 1 }: CardProps) {
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
                onClick(e);
              }
            }
          : undefined
      }
      className={[
        "rounded-panel border",
        ELEVATIONS[elevation],
        isInteractive ? "transition duration-base ease-standard hover:border-line-control hover:bg-surface-3" : "",
        onClick && isInteractive ? "cursor-pointer" : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
