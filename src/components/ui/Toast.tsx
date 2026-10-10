import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

const MAX_VISIBLE = 3;

const DURATION_MS = { info: 4000, error: 6500 } as const;

type ToastTone = "info" | "error";

interface Toast {
  id: string;
  message: string;
  tone?: ToastTone;
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
  const seqRef = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `${Date.now()}-${++seqRef.current}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);
  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="toast-region pointer-events-none fixed inset-x-0 z-toast flex flex-col items-center gap-2 px-4"
      >
        {visible.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const tone = toast.tone ?? "info";
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef<number>(DURATION_MS[tone]);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(1200, remainingRef.current - (Date.now() - startedAt));
    };
  }, [paused, onDismiss, toast.id]);

  const isError = tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={[
        "pointer-events-auto flex w-full max-w-md animate-rise items-start gap-3 rounded-tile border bg-surface-3 py-2.5 pl-3.5 pr-1.5 shadow-e-3",
        isError ? "border-danger-400/40" : "border-line-strong",
      ].join(" ")}
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isError ? "bg-danger-500/15 text-danger-300" : "bg-gold-500/15 text-gold-300"
        }`}
      >
        <Icon name={isError ? "alert" : "info"} size={14} />
      </span>
      <p className="min-w-0 flex-1 break-words py-0.5 text-body text-ink-primary">
        <span className="sr-only">{isError ? "Error: " : ""}</span>
        {toast.message}
      </p>
      <IconButton icon="x" label="Dismiss notification" size="sm" onClick={() => onDismiss(toast.id)} />
    </div>
  );
}
