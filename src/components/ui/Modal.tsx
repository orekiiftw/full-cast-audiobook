import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { Button } from "./Button";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="modal-panel w-[calc(100%-2rem)] max-w-md rounded-3xl border border-white/15 bg-cinema-900 p-0 text-cinema-100 shadow-elevated"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="p-6 sm:p-8">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div>
            <p className="label-caps text-gold-300 mb-2">Make it yours</p>
            <h2 id={titleId} className="font-serif text-3xl tracking-tight">
              {title}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="!px-2.5">
            <Icon name="x" size={18} />
          </Button>
        </div>
        <div className="space-y-5">{children}</div>
      </div>
    </dialog>,
    document.body,
  );
}
