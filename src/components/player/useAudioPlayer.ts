import { useAudioElement } from "./useAudioElement";
import { useAudioTransport, type AudioTransport } from "./useAudioTransport";

export interface AudioPlayerOptions {
  onEnded?: () => void;
  onTimeUpdate?: (positionMs: number) => void;
  onPlayBlocked?: () => void;
}

export function useAudioPlayer(options: AudioPlayerOptions = {}): AudioTransport {
  const session = useAudioElement(options);
  return useAudioTransport(session);
}
