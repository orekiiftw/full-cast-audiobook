import { Card, Icon } from "../ui";
import type { CastMember } from "../../types/api";

interface NarratorCardProps {
  narrator: CastMember;
  playingPreviewId: string | null;
  onPlayPreview: (castId: string) => void;
}

export function NarratorCard({ narrator, playingPreviewId, onPlayPreview }: NarratorCardProps) {
  return (
    <section aria-labelledby="narration-heading" className="min-w-0">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2 border-b border-cinema-700 pb-4">
        <h2 id="narration-heading" className="font-serif text-2xl font-medium tracking-tight text-gold-50">
          Narration
        </h2>
        <span className="label-caps">One voice, every character</span>
      </div>
      <Card className="p-5 sm:p-6">
        <NarratorProfile narrator={narrator} />
        <p className="break-words font-serif text-base italic leading-relaxed text-cinema-300">“{narrator.styleString}”</p>
        <button
          type="button"
          onClick={() => onPlayPreview(narrator.id)}
          aria-label={`${playingPreviewId === narrator.id ? "Pause" : "Play"} narrator voice preview for ${narrator.ttsVoiceName}`}
          className={`mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-cinema-900 ${
            playingPreviewId === narrator.id
              ? "border-gold-400/50 bg-gold-500/10 text-gold-200"
              : "border-cinema-600 text-cinema-200 hover:border-gold-500/50 hover:text-gold-200"
          }`}
        >
          <Icon name={playingPreviewId === narrator.id ? "pause" : "play"} size={14} />
          {playingPreviewId === narrator.id ? "Pause preview" : "Preview voice"}
        </button>
      </Card>
    </section>
  );
}

function NarratorProfile({ narrator }: { narrator: CastMember }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="label-caps text-gold-300">Your narrator</p>
        <h3 className="mt-2 break-words font-serif text-2xl text-cinema-100">{narrator.ttsVoiceName}</h3>
        <p className="mt-1 text-xs text-cinema-400">{narrator.name}</p>
      </div>
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-cinema-700 text-gold-300"
      >
        <Icon name="microphone" size={18} />
      </span>
    </div>
  );
}
