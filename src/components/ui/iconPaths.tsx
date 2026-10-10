// Every glyph is drawn on a 24-unit grid and inherits stroke, cap and join from <Icon>, which
// scales the stroke so it renders at 1.5px at any size. Solid glyphs opt in with `fill`.
const solid = { fill: "currentColor" } as const;

export const ICONS = {
  play: <path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7Z" {...solid} />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" {...solid} />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" {...solid} />
    </>
  ),
  skipBack: (
    <>
      <path d="M18.5 5.6v12.8a.7.7 0 0 1-1.1.6L8.5 12.6a.7.7 0 0 1 0-1.2l8.9-6.4a.7.7 0 0 1 1.1.6Z" {...solid} />
      <path d="M5.5 5v14" />
    </>
  ),
  skipForward: (
    <>
      <path d="M5.5 5.6v12.8a.7.7 0 0 0 1.1.6l8.9-6.4a.7.7 0 0 0 0-1.2L6.6 5a.7.7 0 0 0-1.1.6Z" {...solid} />
      <path d="M18.5 5v14" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  arrowRight: <path d="M4.5 12h15m-6-6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6.5 6.5l11 11m0-11-11 11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 16.5v-11Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5v-11Z" />
    </>
  ),
  library: (
    <>
      <path d="M5 4.5v15M9 4.5v15" />
      <path d="m13.2 5.3 3.9-1 3.6 14.6-3.9 1-3.6-14.6Z" />
    </>
  ),
  microphone: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  waveform: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-12.9 5.2" />
      <path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2" />
      <path d="M17.5 3.5v3.5H14M6.5 20.5V17H10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  upload: <path d="M12 15.5V4.5m-4.5 4.5L12 4.5 16.5 9M5 15v2.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V15" />,
  link: (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12.3a.8.8 0 0 1 0-.6C4.4 7.9 8 5.5 12 5.5s7.6 2.4 9.2 6.2a.8.8 0 0 1 0 .6c-1.6 3.8-5.2 6.2-9.2 6.2s-7.6-2.4-9.2-6.2Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.6 5.6c.5-.1.9-.1 1.4-.1 4 0 7.6 2.4 9.2 6.2a.8.8 0 0 1 0 .6 10 10 0 0 1-2 3M6.6 6.6a10 10 0 0 0-3.8 5.1.8.8 0 0 0 0 .6c1.6 3.8 5.2 6.2 9.2 6.2 1.9 0 3.8-.6 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.4 3 17.5a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.3 4.6-4.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  moon: <path d="M19.5 14.2A7.5 7.5 0 0 1 9.8 4.5a7.5 7.5 0 1 0 9.7 9.7Z" />,
  gauge: (
    <>
      <path d="M4.2 17a8.5 8.5 0 1 1 15.6 0" />
      <path d="m12 13 3.5-4" />
      <circle cx="12" cy="13.5" r="1" {...solid} />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2m3 0-.8 11.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7m4 4v5m4-5v5" />,
  logout: <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4m-4 4h10" />,
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="m7.5 9.5 2.5 2.5-2.5 2.5M12.5 14.5h4" />
    </>
  ),
  pen: <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.2L15.8 5a1.4 1.4 0 0 1 2 0l1.2 1.2a1.4 1.4 0 0 1 0 2L8.7 18.5l-4.2 1Z" />,
  headphones: (
    <>
      <path d="M4 17v-4.5a8 8 0 0 1 16 0V17" />
      <rect x="3.5" y="13.5" width="4.5" height="6.5" rx="1.5" />
      <rect x="16" y="13.5" width="4.5" height="6.5" rx="1.5" />
    </>
  ),
  sparkle: <path d="M12 4.5c.6 3.6 1.9 4.9 5.5 5.5-3.6.6-4.9 1.9-5.5 5.5-.6-3.6-1.9-4.9-5.5-5.5 3.6-.6 4.9-1.9 5.5-5.5Z" />,
};

export type IconName = keyof typeof ICONS;
