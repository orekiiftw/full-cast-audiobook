import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import type { CastMember } from "../../types/api";

interface NarratorCardProps {
  narrator: CastMember;
  playingPreviewId: string | null;
  onPlayPreview: (castId: string) => void;
}

export function NarratorCard({ narrator, playingPreviewId, onPlayPreview }: NarratorCardProps) {
  return (
    <section className="mb-14">
      <div className="flex items-baseline justify-between pb-4 mb-5 border-b border-white/[0.05]">
        <h2 className="font-serif text-2xl font-medium tracking-tight">Narration</h2>
        <span className="label-caps">Single narrator</span>
      </div>
      <Card className="p-4 flex justify-between items-center gap-4" isInteractive>
        <div className="min-w-0">
          <h4 className="font-serif text-[15px] font-medium truncate">
            {narrator.name}
            <span className="ml-2 text-[11px] font-sans font-normal text-gold-400/90 uppercase tracking-[0.14em]">
              {narrator.ttsVoiceName}
            </span>
          </h4>
          <p className="text-[11px] text-cinema-400 mt-1 tracking-wide">
            Voices every character &amp; narration
          </p>
          <p className="text-[11px] text-cinema-500 mt-1.5 italic line-clamp-1 font-serif">
            “{narrator.styleString}”
          </p>
        </div>
        <button
          onClick={() => onPlayPreview(narrator.id)}
          aria-label={`Preview narrator voice ${narrator.ttsVoiceName}`}
          className={`w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-all duration-300 ${
            playingPreviewId === narrator.id
              ? "border-gold-400/50 bg-gold-500/15 text-gold-300 shadow-glow-sm"
              : "border-white/[0.08] text-gold-400 hover:border-gold-500/40 hover:bg-gold-500/10"
          }`}
        >
          <Icon name={playingPreviewId === narrator.id ? "pause" : "play"} size={14} />
        </button>
      </Card>
    </section>
  );
}
