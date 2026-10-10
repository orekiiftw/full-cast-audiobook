import type { BadgeTone } from "../ui";
import type { BookStatus } from "../../types/api";

interface BookStatusPresentation {
  label: string;
  tone: BadgeTone;
  pulse: boolean;
  active: boolean;
}

export const BOOK_STATUS: Record<BookStatus, BookStatusPresentation> = {
  discovering: { label: "Discovering", tone: "cyan", pulse: true, active: true },
  casting: { label: "Preparing", tone: "purple", pulse: true, active: true },
  in_progress: { label: "Performing", tone: "gold", pulse: true, active: true },
  failed: { label: "Failed", tone: "red", pulse: false, active: false },
  ready: { label: "Ready", tone: "emerald", pulse: false, active: false },
};

export function bookStatusOf(status: string): BookStatusPresentation {
  return BOOK_STATUS[status as BookStatus] ?? { label: status, tone: "neutral", pulse: false, active: false };
}
