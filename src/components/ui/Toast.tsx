import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { Icon } from "./Icon";

interface Toast {
  id: string;
  message: string;
  tone?: "info" | "error";
}

interface ToastContextValue {
  showToast: (message: string, tone?: Toast["tone"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // Memoized: without this, every toast (appear + auto-dismiss) created a new
  // context value and re-rendered EVERY useToast consumer — App, Library,
  // BookDetail, and the whole Player including its memoized transcript rows.
  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-32 left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={[
              "pointer-events-auto flex items-center gap-2.5 rounded-full border px-4 py-2.5 text-sm shadow-elevated backdrop-blur-xl animate-fade-up",
              toast.tone === "error"
                ? "border-red-900/40 bg-red-950/85 text-red-100"
                : "border-white/[0.08] bg-cinema-900/90 text-cinema-100",
            ].join(" ")}
          >
            {toast.tone === "error" && <Icon name="x" size={14} className="text-red-400" />}
            <span className="font-medium tracking-tight">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
