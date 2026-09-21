import { useState } from "react";
import { apiFetch, reportNetworkError } from "../../lib/api";
import { useToast } from "../ui";
import { addBookToast, buildAddBookBody, isMagnetInput, type AddBookValues, type AddMode } from "./addBook";
import type { Classic } from "./classics";
import type { Book } from "../../types/api";

const EMPTY_VALUES: AddBookValues = { title: "", author: "", magnet: "", file: null };

export interface AddBookFormModel {
  isModalOpen: boolean;
  mode: AddMode;
  values: AddBookValues;
  submitting: boolean;
  open: () => void;
  close: () => void;
  openClassic: (classic: Classic) => void;
  selectMode: (mode: AddMode) => void;
  updateValues: (patch: Partial<AddBookValues>) => void;
  submit: (event: React.FormEvent) => void;
}

interface UseAddBookFormOptions {
  onSelectBook: (bookId: string) => void;
  refresh: () => void;
}

export function useAddBookForm({ onSelectBook, refresh }: UseAddBookFormOptions): AddBookFormModel {
  const { showToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<AddMode>("search");
  const [values, setValues] = useState<AddBookValues>(EMPTY_VALUES);
  const [submitting, setSubmitting] = useState(false);

  const resetValues = () => setValues(EMPTY_VALUES);

  const openClassic = (classic: Classic) => {
    setMode("search");
    setValues((current) => ({ ...current, title: classic.title, author: classic.author }));
    setIsModalOpen(true);
  };

  const updateValues = (patch: Partial<AddBookValues>) => setValues((current) => ({ ...current, ...patch }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (mode === "magnet" && !isMagnetInput(values.magnet)) {
      showToast("Enter a magnet link (magnet:?xt=urn:btih:…) or a 40-character info-hash.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiFetch("/api/books", { method: "POST", body: buildAddBookBody(mode, values) });

      if (response.ok) {
        const newBook = (await response.json()) as Book;
        refresh();
        setIsModalOpen(false);
        resetValues();
        onSelectBook(newBook.id);
        showToast(addBookToast(newBook));
        return;
      }

      const err = (await response.json().catch(() => null)) as { error?: string; book?: Book } | null;
      if (err?.book?.id) {
        setIsModalOpen(false);
        resetValues();
        onSelectBook(err.book.id);
      }
      showToast(err?.error || "Failed to add book.", "error");
    } catch (error) {
      reportNetworkError(error, showToast);
    } finally {
      setSubmitting(false);
    }
  };

  return {
    isModalOpen,
    mode,
    values,
    submitting,
    open: () => setIsModalOpen(true),
    close: () => setIsModalOpen(false),
    openClassic,
    selectMode: setMode,
    updateValues,
    submit,
  };
}
