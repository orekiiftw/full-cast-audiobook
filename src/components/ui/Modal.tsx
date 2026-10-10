import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";

const INITIAL_FOCUS_SELECTOR = "[data-autofocus], input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled)";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  size?: "md" | "lg";
}

export function Modal({ isOpen, onClose, title, children, eyebrow, description, size = "md" }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdropRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;

    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    bodyRef.current?.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR)?.focus();

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={[
        "modal m-0 mt-auto w-full max-w-full overflow-hidden rounded-t-stage border border-b-0 border-line-strong bg-surface-2 text-ink-primary shadow-e-3",
        "open:flex open:flex-col sm:m-auto sm:rounded-stage sm:border-b",
        size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg",
      ].join(" ")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        // Some browsers close on a repeated Escape despite preventDefault; keep state in sync.
        if (!event.currentTarget.open) onClose();
      }}
      onPointerDown={(event) => {
        pressStartedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressStartedOnBackdropRef.current) onClose();
        pressStartedOnBackdropRef.current = false;
      }}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line-hairline px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5 text-gold-400">{eyebrow}</p>}
          <h2 id={titleId} className="font-serif text-title-lg font-medium text-ink-primary sm:text-display-md">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1.5 text-caption text-ink-tertiary">
              {description}
            </p>
          )}
        </div>
        <IconButton icon="x" label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-0.5" />
      </header>
      <div ref={bodyRef} className="scroll-quiet min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
