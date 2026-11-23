import type { BadgeTone } from "@/components/ui/feedback";
import type { BookStatus, ChapterStatus } from "@/api/types";

interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  active: boolean;
}

export const BOOK_STATUS: Record<BookStatus, StatusPresentation> = {
  discovering: { label: "Discovering", tone: "cyan", active: true },
  casting: { label: "Preparing", tone: "purple", active: true },
  in_progress: { label: "Performing", tone: "gold", active: true },
  failed: { label: "Failed", tone: "red", active: false },
  ready: { label: "Ready", tone: "emerald", active: false },
};

export function bookStatusOf(status: string): StatusPresentation {
  return BOOK_STATUS[status as BookStatus] ?? { label: status, tone: "neutral", active: false };
}

export const CHAPTER_STATUS: Record<ChapterStatus, StatusPresentation | null> = {
  queued: { label: "Queued", tone: "neutral", active: false },
  processing: { label: "Performing", tone: "gold", active: true },
  partial_ready: { label: "Live", tone: "emerald", active: true },
  ready: null,
  failed: { label: "Failed", tone: "red", active: false },
};

export function chapterStatusOf(status: string): StatusPresentation {
  return CHAPTER_STATUS[status as ChapterStatus] ?? { label: status, tone: "neutral", active: false };
}
