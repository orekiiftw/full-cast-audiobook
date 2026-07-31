import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Button } from "./Button";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="modal-panel relative w-full max-w-md overflow-y-auto rounded-3xl border border-white/[0.08] bg-gradient-to-b from-cinema-800 to-cinema-900 p-7 shadow-elevated animate-fade-up">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
        <div className="relative mb-6 flex items-start justify-between gap-4">
          <h2 id="modal-title" className="font-serif text-2xl font-medium tracking-tight text-gradient">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="!rounded-full !px-2">
            <Icon name="x" size={18} />
          </Button>
        </div>

        <div className="relative space-y-4">{children}</div>
      </div>
    </div>
  );
}
