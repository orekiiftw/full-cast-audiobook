import { useState } from "react";
import { apiFetch, reportNetworkError } from "../../lib/api";
import { useToast } from "../ui";

export interface PronunciationFormModel {
  term: string;
  hint: string;
  adding: boolean;
  setTerm: (value: string) => void;
  setHint: (value: string) => void;
  submit: (event: React.FormEvent) => void;
}

interface UsePronunciationFormOptions {
  bookId: string;
  reload: () => Promise<void>;
}

export function usePronunciationForm({ bookId, reload }: UsePronunciationFormOptions): PronunciationFormModel {
  const { showToast } = useToast();
  const [term, setTerm] = useState("");
  const [hint, setHint] = useState("");
  const [adding, setAdding] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!term || !hint) return;
    setAdding(true);

    try {
      const response = await apiFetch(`/api/books/${bookId}/pronunciation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, phoneticHint: hint }),
      });

      if (response.ok) {
        setTerm("");
        setHint("");
        void reload();
        showToast(`Pronunciation added for "${term}".`);
      } else {
        showToast("Failed to save pronunciation.", "error");
      }
    } catch (error) {
      reportNetworkError(error, showToast);
    } finally {
      setAdding(false);
    }
  };

  return { term, hint, adding, setTerm, setHint, submit };
}
