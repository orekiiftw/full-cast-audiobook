import { useState } from "react";
import { apiFetch, deleteBook, reportNetworkError } from "../../lib/api";
import { useToast } from "../ui";

export interface BookMaintenanceModel {
  retrying: boolean;
  retry: () => Promise<void>;
  deleting: boolean;
  remove: (title: string) => Promise<void>;
}

interface UseBookMaintenanceOptions {
  bookId: string;
  onBack: () => void;
  reload: () => Promise<void>;
  clearProgressLog: () => void;
}

export function useBookMaintenance({ bookId, onBack, reload, clearProgressLog }: UseBookMaintenanceOptions): BookMaintenanceModel {
  const { showToast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      const response = await apiFetch(`/api/books/${bookId}/retry`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        showToast(body?.error || "Retry failed.", "error");
        return;
      }
      showToast("Retrying performance pipeline…");
      clearProgressLog();
      await reload();
    } catch (error) {
      reportNetworkError(error, showToast);
    } finally {
      setRetrying(false);
    }
  };

  const remove = async (title: string) => {
    setDeleting(true);
    try {
      if (await deleteBook(bookId, title, showToast)) onBack();
    } finally {
      setDeleting(false);
    }
  };

  return { retrying, retry, deleting, remove };
}
