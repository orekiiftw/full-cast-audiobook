import { Button, Icon } from "../ui";

interface PlayerHeaderProps {
  bookTitle: string;
  chapterTitle: string;
  isBufferingNext: boolean;
  onCollapse: () => void;
}

export function PlayerHeader({ bookTitle, chapterTitle, isBufferingNext, onCollapse }: PlayerHeaderProps) {
  return (
    <div className="flex justify-between items-start border-b border-white/[0.05] pb-5 mb-5">
      <div className="min-w-0">
        <span className="label-caps text-gold-400/90 block truncate">{bookTitle}</span>
        <h2 className="font-serif text-2xl sm:text-3xl font-medium text-gradient truncate mt-1">{chapterTitle}</h2>
        {isBufferingNext && <p className="text-xs text-gold-400 mt-2 animate-pulse-soft tracking-wide">Performing next line…</p>}
      </div>
      <Button variant="ghost" size="sm" onClick={onCollapse} className="shrink-0">
        Collapse
        <Icon name="chevronDown" size={14} />
      </Button>
    </div>
  );
}
