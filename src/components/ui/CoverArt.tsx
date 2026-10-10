import { useState } from "react";

type CoverSize = "xs" | "sm" | "md" | "lg";

// Typographic covers pick a stable palette from the title so a shelf of uncovered books still
// reads as distinct objects rather than identical placeholders.
const PALETTES = [
  "from-gold-700 via-gold-900 to-gold-950",
  "from-studio-600 via-studio-800 to-studio-950",
  "from-surface-4 via-surface-2 to-surface-0",
  "from-danger-500/40 via-surface-3 to-surface-1",
  "from-success-500/30 via-surface-3 to-surface-1",
  "from-gold-800 via-surface-3 to-surface-1",
];

const SCALES: Record<Exclude<CoverSize, "xs">, { pad: string; title: string; author: string | null }> = {
  sm: { pad: "p-3", title: "text-caption", author: null },
  md: { pad: "p-4", title: "text-title-md", author: "text-caption" },
  lg: { pad: "p-6", title: "text-title-lg sm:text-display-md", author: "text-body" },
};

interface CoverArtProps {
  src: string | null;
  title: string;
  author?: string;
  size?: CoverSize;
  className?: string;
  imageClassName?: string;
  loading?: "lazy" | "eager";
}

// Covers are always decorative: every placement pairs them with the visible or accessible title.
export function CoverArt({ src, title, author, size = "md", className = "", imageClassName = "", loading = "lazy" }: CoverArtProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;

  return (
    <div className={`cover-art ${className}`}>
      {showImage ? (
        <img
          src={src}
          alt=""
          loading={loading}
          decoding="async"
          onError={() => setFailedSrc(src)}
          className={`h-full w-full object-cover ${imageClassName}`}
        />
      ) : (
        <TypographicCover title={title} author={author} size={size} />
      )}
    </div>
  );
}

function TypographicCover({ title, author, size }: { title: string; author?: string; size: CoverSize }) {
  const palette = PALETTES[paletteIndex(title)];

  if (size === "xs") {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-gradient-to-b ${palette}`}>
        <span className="font-serif text-title-md font-medium text-ink-primary">{title.trim().charAt(0).toUpperCase() || "N"}</span>
      </div>
    );
  }

  const scale = SCALES[size];
  return (
    <div className={`flex h-full w-full flex-col justify-between bg-gradient-to-b ${palette} ${scale.pad}`}>
      {scale.author ? <span className="eyebrow text-gold-200/80">Narratea</span> : <span />}
      <span className="min-w-0">
        <span className={`line-clamp-4 text-balance break-words font-serif font-medium text-ink-primary ${scale.title}`}>{title}</span>
        {author && scale.author && (
          <span className={`mt-2 block truncate border-t border-ink-primary/15 pt-2 font-serif italic text-ink-secondary ${scale.author}`}>
            {author}
          </span>
        )}
      </span>
    </div>
  );
}

function paletteIndex(title: string): number {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return hash % PALETTES.length;
}
