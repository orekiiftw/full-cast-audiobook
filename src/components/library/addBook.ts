import type { Book } from "../../types/api";

export type AddMode = "search" | "magnet" | "file";

export interface AddBookValues {
  title: string;
  author: string;
  magnet: string;
  file: File | null;
}

export const ADD_MODES: Array<{ id: AddMode; label: string; icon: "search" | "upload" | "link" }> = [
  { id: "search", label: "Search", icon: "search" },
  { id: "file", label: "Upload", icon: "upload" },
  { id: "magnet", label: "Magnet", icon: "link" },
];

export function isMagnetInput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("magnet:?xt=urn:btih:") || /^[0-9a-fA-F]{40}$/.test(trimmed);
}

export function buildAddBookBody(mode: AddMode, values: AddBookValues): FormData {
  const formData = new FormData();

  if (mode === "file" && values.file) {
    formData.append("file", values.file);
  } else if (mode === "magnet") {
    formData.append("magnet", values.magnet.trim());
  } else {
    formData.append("title", values.title.trim());
    formData.append("author", values.author.trim());
  }

  return formData;
}

export function addBookToast(book: Book): string {
  const isOpened = book.status === "ready" || book.status === "in_progress" || book.status === "casting";
  return isOpened ? `Opened “${book.title}”.` : `Queued “${book.title || "book"}” for performance.`;
}
