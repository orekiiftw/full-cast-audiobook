import { Card, Icon, LevelMeter } from "../ui";
import type { CastMember } from "../../types/api";

interface NarratorCardProps {
  narrator: CastMember;
  playingPreviewId: string | null;
  onPlayPreview: (castId: string) => void;
}

export function NarratorCard({ narrator, playingPreviewId, onPlayPreview }: NarratorCardProps) {
  const previewing = playingPreviewId === narrator.id;

  return (
    <section aria-labelledby="narration-heading" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line-hairline pb-3">
        <h2 id="narration-heading" className="font-serif text-title-lg font-medium text-ink-primary">
          Narration
        </h2>
        <span className="eyebrow">One voice, every character</span>
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border transition-colors duration-base ${
              previewing ? "border-transparent bg-gold-300 text-ink-inverse" : "border-line-strong bg-surface-3 text-gold-300"
            }`}
          >
            {previewing ? <LevelMeter bars={4} className="h-4" /> : <Icon name="microphone" size={20} />}
          </span>
          <div className="min-w-0">
            <p className="eyebrow text-gold-400">Your narrator</p>
            <h3 className="mt-1 break-words font-serif text-title-lg font-medium text-ink-primary">{narrator.ttsVoiceName}</h3>
            <p className="text-caption text-ink-tertiary">{narrator.name}</p>
          </div>
        </div>

        <blockquote className="mt-5 border-l-2 border-line-accent pl-4">
          <p className="break-words font-serif text-body-lg italic text-ink-secondary">“{narrator.styleString}”</p>
        </blockquote>

        <button
          type="button"
          onClick={() => onPlayPreview(narrator.id)}
          aria-label={`${previewing ? "Pause" : "Play"} narrator voice preview for ${narrator.ttsVoiceName}`}
          className={`mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full border px-4 text-caption font-semibold transition-colors duration-base ease-standard ${
            previewing
              ? "border-line-accent bg-gold-500/10 text-gold-200"
              : "border-line-strong bg-surface-3 text-ink-primary hover:border-line-control hover:bg-surface-4"
          }`}
        >
          <Icon name={previewing ? "pause" : "play"} size={16} />
          {previewing ? "Pause preview" : "Preview voice"}
        </button>
      </Card>
    </section>
  );
}
