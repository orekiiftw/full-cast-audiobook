import { BrandLogo, Icon, LevelMeter, type IconName } from "../ui";

const STAGE_COVERS = [
  {
    title: "Dracula",
    author: "Bram Stoker",
    surface: "bg-gradient-to-b from-danger-500/30 via-surface-3 to-surface-1",
    position: "left-0 top-10 -rotate-6",
  },
  {
    title: "Frankenstein",
    author: "Mary Shelley",
    surface: "bg-gradient-to-b from-studio-600 via-studio-900 to-surface-1",
    position: "right-0 top-10 rotate-6",
  },
  {
    title: "The Time Machine",
    author: "H. G. Wells",
    surface: "bg-gradient-to-b from-gold-600 via-gold-900 to-gold-950",
    position: "left-1/2 top-0 z-10 -translate-x-1/2",
  },
];

const FEATURES: Array<{ icon: IconName; label: string }> = [
  { icon: "lock", label: "Private library" },
  { icon: "headphones", label: "Seamless listening" },
  { icon: "waveform", label: "Live studio" },
];

export function AuthIntro() {
  return (
    <section className="animate-rise" aria-labelledby="auth-intro-title">
      <BrandLogo size="md" />
      <p className="eyebrow mt-10 hidden text-gold-400 lg:block">Your private listening room</p>
      <h1
        id="auth-intro-title"
        className="mt-6 max-w-xl text-balance font-serif text-display-md font-medium text-ink-primary sm:text-display-lg lg:mt-4 lg:text-display-xl"
      >
        Every story, performed.
      </h1>
      <p className="mt-3 max-w-md text-pretty text-body text-ink-secondary lg:mt-5 lg:text-body-lg">
        Upload a DRM-free EPUB and one warm narrator voices every character with director-guided emotion, chapter by chapter, as it is
        generated.
      </p>

      <AuthStage />

      <ul className="mt-10 hidden flex-wrap gap-x-6 gap-y-2 text-caption text-ink-tertiary lg:flex">
        {FEATURES.map((feature) => (
          <li key={feature.label} className="flex items-center gap-2">
            <Icon name={feature.icon} size={16} className="text-gold-400" />
            {feature.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Purely decorative: a fanned stack of typographic covers with a "now performing" strip that
// previews what the library looks like once a book is generating.
function AuthStage() {
  return (
    <div className="relative mt-12 hidden max-w-md lg:block" aria-hidden="true">
      <div className="relative mx-auto h-64 w-full max-w-sm">
        {STAGE_COVERS.map((cover) => (
          <div
            key={cover.title}
            className={`cover-art absolute flex aspect-cover w-36 flex-col justify-between rounded-tile p-4 shadow-cover ${cover.surface} ${cover.position}`}
          >
            <span className="eyebrow text-ink-secondary">{cover.author}</span>
            <span className="text-balance font-serif text-title-lg font-medium text-ink-primary">{cover.title}</span>
          </div>
        ))}
      </div>
      <div className="relative z-20 -mt-6 flex items-center gap-3 rounded-tile border border-line-strong bg-surface-2 px-4 py-3 shadow-e-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-gold-300 text-ink-inverse">
          <LevelMeter bars={4} className="h-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-gold-400">Now performing</p>
          <p className="truncate text-caption text-ink-primary">The Time Machine · Chapter 3</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-primary/10">
            <div className="h-full w-2/5 rounded-full bg-gold-400" />
          </div>
        </div>
        <span className="font-mono text-caption tabular-nums text-ink-tertiary">12:48</span>
      </div>
    </div>
  );
}
