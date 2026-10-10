import type { ReactNode } from "react";

export function AppBar({ children }: { children: ReactNode }) {
  return (
    <header className="chrome-glass sticky top-0 z-header border-b border-line-hairline">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">{children}</div>
    </header>
  );
}
