import { useCallback, useState } from "react";
import { apiFetch, reportNetworkError } from "../../lib/api";
import type { Segment } from "../../types/api";
import { useToast } from "../ui";

interface UseLineRegenerationOptions {
  chapterId: string;
  setSegmentsList: (segments: Segment[]) => void;
  restartSegmentIfActive: (freshSegments: Segment[], segmentId: string) => void;
}

export interface LineRegeneration {
  isModalOpen: boolean;
  instruction: string;
  isRegenerating: boolean;
  openFor: (segmentId: string) => void;
  close: () => void;
  setInstruction: (instruction: string) => void;
  submit: () => void;
}

export function useLineRegeneration({ chapterId, setSegmentsList, restartSegmentIfActive }: UseLineRegenerationOptions): LineRegeneration {
  const { showToast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);

  const openFor = useCallback((id: string) => {
    setSegmentId(id);
    setIsModalOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const submit = useCallback(async () => {
    if (!segmentId) return;
    setIsRegenerating(true);

    try {
      const response = await apiFetch(`/api/segments/${segmentId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });

      if (response.ok) {
        await applyRegeneratedLine(chapterId, segmentId, setSegmentsList, restartSegmentIfActive);
        setIsModalOpen(false);
        setInstruction("");
        showToast("Line re-performed.");
      } else {
        showToast("Regeneration failed.", "error");
      }
    } catch (err) {
      reportNetworkError(err, showToast);
    } finally {
      setIsRegenerating(false);
    }
  }, [chapterId, instruction, restartSegmentIfActive, segmentId, setSegmentsList, showToast]);

  return { isModalOpen, instruction, isRegenerating, openFor, close, setInstruction, submit };
}

async function applyRegeneratedLine(
  chapterId: string,
  segmentId: string,
  setSegmentsList: (segments: Segment[]) => void,
  restartSegmentIfActive: (freshSegments: Segment[], segmentId: string) => void,
): Promise<void> {
  const response = await apiFetch(`/api/chapters/${chapterId}/segments`);
  if (!response.ok) return;

  const data = (await response.json()) as { segments?: Segment[] };
  const freshSegments = data.segments ?? [];
  setSegmentsList(freshSegments);
  restartSegmentIfActive(freshSegments, segmentId);
}
