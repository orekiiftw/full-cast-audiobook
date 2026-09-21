import { useEffect, useRef, useState } from "react";
import { useToast } from "../ui";

export interface NarratorPreviewModel {
  playingPreviewId: string | null;
  playPreview: (castId: string) => Promise<void>;
}

export function useNarratorPreview(activeChapterId?: string): NarratorPreviewModel {
  const { showToast } = useToast();
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingPreviewId, setPlayingPreviewId] = useState<string | null>(null);

  useEffect(() => {
    return () => previewAudioRef.current?.pause();
  }, []);

  useEffect(() => {
    if (!activeChapterId) return;
    previewAudioRef.current?.pause();
    setPlayingPreviewId(null);
  }, [activeChapterId]);

  const playPreview = async (castId: string) => {
    if (playingPreviewId === castId) {
      previewAudioRef.current?.pause();
      setPlayingPreviewId(null);
      return;
    }

    try {
      setPlayingPreviewId(castId);
      previewAudioRef.current?.pause();

      const audio = new Audio(`/api/cast/${castId}/preview`);
      previewAudioRef.current = audio;
      audio.onended = () => {
        if (previewAudioRef.current === audio) setPlayingPreviewId(null);
      };
      audio.onerror = () => {
        if (previewAudioRef.current === audio) setPlayingPreviewId(null);
      };

      await audio.play();
    } catch (error) {
      console.error("Preview play failed:", error);
      setPlayingPreviewId(null);
      showToast("Failed to synthesize voice preview.", "error");
    }
  };

  return { playingPreviewId, playPreview };
}
