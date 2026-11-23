// "The Listening Room" token layer, ported from the web client's tailwind.config.js.
// Surfaces are warm green-charcoal, text is a four-step ramp, gold is the single
// action/emphasis accent, and "studio" is the cool counterpoint for numeric readouts.
// Contrast for every text/surface pair was checked against WCAG AA before these values
// were fixed; the numbers below are the same numbers the web client ships.

export const colors = {
  surface: {
    0: "#0b0f0d",
    1: "#111613",
    2: "#171d1a",
    3: "#1e2621",
    4: "#262f29",
  },
  ink: {
    primary: "#f2eee4",
    secondary: "#c3c8be",
    tertiary: "#969f96",
    disabled: "#646d66",
    inverse: "#14110a",
  },
  line: {
    hairline: "rgba(242, 238, 228, 0.07)",
    strong: "rgba(242, 238, 228, 0.13)",
    control: "rgba(242, 238, 228, 0.38)",
    accent: "rgba(215, 172, 95, 0.5)",
  },
  gold: {
    50: "#fbf7ee",
    100: "#f6ecd6",
    200: "#ecd9ab",
    300: "#e3c587",
    400: "#d7ac5f",
    500: "#c4923e",
    600: "#a6772f",
    700: "#835c26",
    800: "#614520",
    900: "#43311a",
    950: "#261c0f",
  },
  studio: {
    50: "#f3f5fa",
    100: "#e3e7f1",
    200: "#cbd2e6",
    300: "#b3bdd9",
    400: "#8f9cc2",
    500: "#6f7da6",
    600: "#576386",
    700: "#434d69",
    800: "#2f3649",
    900: "#1e2331",
    950: "#12151e",
  },
  success: { 300: "#8fd3ae", 400: "#5fbf8c", 500: "#3fa572" },
  warning: { 300: "#f2b872", 400: "#e99a45", 500: "#cf7f2b" },
  danger: { 300: "#f4978b", 400: "#ec6f60", 500: "#d9503f" },
  info: { 300: "#9cc3e6", 400: "#6fa6d8", 500: "#4c86bd" },
} as const;

// Registered family names must match the keys passed to expo-font in the root layout.
export const fonts = {
  serif: "Fraunces_500Medium",
  serifRegular: "Fraunces_400Regular",
  serifItalic: "Fraunces_400Regular_Italic",
  serifBold: "Fraunces_600SemiBold",
  sans: "DMSans_400Regular",
  sansMedium: "DMSans_500Medium",
  sansBold: "DMSans_700Bold",
  sansItalic: "DMSans_400Regular_Italic",
  mono: "monospace",
} as const;

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

// rem → px at the web root's 16px, with the same line-height ratios and tracking.
export const type = {
  displayXl: { fontSize: 44, lineHeight: 46, letterSpacing: -1.1 },
  displayLg: { fontSize: 36, lineHeight: 40, letterSpacing: -0.79 },
  displayMd: { fontSize: 28, lineHeight: 32, letterSpacing: -0.5 },
  titleLg: { fontSize: 22, lineHeight: 28, letterSpacing: -0.26 },
  titleMd: { fontSize: 18, lineHeight: 24, letterSpacing: -0.14 },
  bodyLg: { fontSize: 16, lineHeight: 26, letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 23, letterSpacing: 0 },
  caption: { fontSize: 13, lineHeight: 19, letterSpacing: 0 },
  micro: { fontSize: 11, lineHeight: 14, letterSpacing: 1.54 },
} satisfies Record<string, TextStyleToken>;

export const radius = {
  control: 10,
  tile: 14,
  panel: 20,
  stage: 28,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const motion = {
  fast: 140,
  base: 180,
  enter: 280,
  slow: 400,
} as const;

// RN shadows are per-platform, so the two layers the web expresses as one box-shadow
// become one elevation + one border treatment here.
export const elevation = {
  e1: {
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  e2: {
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  e3: {
    shadowColor: "#000",
    shadowOpacity: 0.7,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  cover: {
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  accent: {
    shadowColor: colors.gold[500],
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;
