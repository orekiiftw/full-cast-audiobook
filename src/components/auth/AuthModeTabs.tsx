import type { AuthMode } from "../../types/api";

export function AuthModeTabs({ mode, onSelect }: { mode: AuthMode; onSelect: (mode: AuthMode) => void }) {
  const isLogin = mode === "login";

  return (
    <div
      className="mt-7 grid grid-cols-2 gap-1 rounded-2xl border border-white/[0.05] bg-cinema-950/70 p-1"
      role="tablist"
      aria-label="Authentication mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={isLogin}
        onClick={() => onSelect("login")}
        className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${isLogin ? "bg-cinema-700/80 text-white shadow-sm" : "text-cinema-400 hover:text-cinema-200"}`}
      >
        Sign in
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={!isLogin}
        onClick={() => onSelect("signup")}
        className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition-all ${!isLogin ? "bg-cinema-700/80 text-white shadow-sm" : "text-cinema-400 hover:text-cinema-200"}`}
      >
        Create account
      </button>
    </div>
  );
}
