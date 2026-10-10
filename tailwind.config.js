/** @type {import('tailwindcss').Config} */

// "The Listening Room" token layer. Surfaces are warm green-charcoal, text is a four-step
// ramp, gold is the single action/emphasis accent, and "studio" is the cool counterpoint
// reserved for data surfaces (meters, consoles, numeric readouts). Contrast for every
// text/surface pair was checked against WCAG AA before these values were fixed.
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      screens: {
        // Hover-revealed controls stay visible on devices that cannot hover.
        touch: { raw: "(hover: none)" },
      },
      colors: {
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
      },
      fontFamily: {
        serif: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"DM Sans"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "display-xl": ["2.75rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-lg": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.022em" }],
        "display-md": ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.018em" }],
        "title-lg": ["1.375rem", { lineHeight: "1.25", letterSpacing: "-0.012em" }],
        "title-md": ["1.125rem", { lineHeight: "1.35", letterSpacing: "-0.008em" }],
        "body-lg": ["1rem", { lineHeight: "1.6" }],
        body: ["0.9375rem", { lineHeight: "1.55" }],
        caption: ["0.8125rem", { lineHeight: "1.45" }],
        micro: ["0.6875rem", { lineHeight: "1.3", letterSpacing: "0.14em" }],
      },
      letterSpacing: {
        caps: "0.14em",
      },
      aspectRatio: {
        cover: "2 / 3",
      },
      maxWidth: {
        measure: "40rem",
      },
      zIndex: {
        header: "40",
        dock: "50",
        toast: "60",
      },
      borderRadius: {
        control: "10px",
        tile: "14px",
        panel: "20px",
        stage: "28px",
      },
      boxShadow: {
        "e-1": "inset 0 1px 0 0 rgba(255, 255, 255, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 4px 12px -4px rgba(0, 0, 0, 0.4)",
        "e-2": "inset 0 1px 0 0 rgba(255, 255, 255, 0.05), 0 2px 4px 0 rgba(0, 0, 0, 0.35), 0 16px 36px -10px rgba(0, 0, 0, 0.6)",
        "e-3": "inset 0 1px 0 0 rgba(255, 255, 255, 0.06), 0 4px 10px 0 rgba(0, 0, 0, 0.35), 0 36px 72px -18px rgba(0, 0, 0, 0.75)",
        "e-dock": "inset 0 1px 0 0 rgba(255, 255, 255, 0.05), 0 -12px 40px -12px rgba(0, 0, 0, 0.7)",
        cover: "0 1px 1px 0 rgba(0, 0, 0, 0.35), 0 10px 20px -6px rgba(0, 0, 0, 0.55), 0 28px 56px -18px rgba(0, 0, 0, 0.7)",
        "cover-lift": "0 1px 1px 0 rgba(0, 0, 0, 0.35), 0 16px 28px -8px rgba(0, 0, 0, 0.6), 0 40px 72px -20px rgba(0, 0, 0, 0.75)",
        "accent-press": "inset 0 1px 0 0 rgba(255, 255, 255, 0.4), inset 0 -1px 0 0 rgba(0, 0, 0, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.4)",
        "accent-lift":
          "inset 0 1px 0 0 rgba(255, 255, 255, 0.45), inset 0 -1px 0 0 rgba(0, 0, 0, 0.12), 0 8px 20px -8px rgba(196, 146, 62, 0.55)",
        inset: "inset 0 1px 2px 0 rgba(0, 0, 0, 0.35)",
      },
      transitionTimingFunction: {
        "out-expo": EASE_OUT,
        standard: "cubic-bezier(0.2, 0, 0, 1)",
      },
      transitionDuration: {
        fast: "140ms",
        base: "180ms",
        enter: "280ms",
        slow: "400ms",
      },
      keyframes: {
        fade: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "sheet-in": {
          from: { opacity: "0", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(100%)" },
        },
        indeterminate: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(250%)" },
        },
        meter: {
          "0%, 100%": { transform: "scaleY(0.3)" },
          "50%": { transform: "scaleY(1)" },
        },
        breathe: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
        "boot-sweep": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        fade: `fade 220ms ${EASE_OUT} both`,
        rise: `rise 320ms ${EASE_OUT} both`,
        "scale-in": `scale-in 260ms ${EASE_OUT} both`,
        "sheet-in": `sheet-in 340ms ${EASE_OUT} both`,
        shimmer: "shimmer 1.6s linear infinite",
        indeterminate: "indeterminate 1.4s cubic-bezier(0.65, 0, 0.35, 1) infinite",
        meter: "meter 1.1s ease-in-out infinite",
        breathe: "breathe 2.4s ease-in-out infinite",
        "boot-sweep": `boot-sweep 1.2s ${EASE_OUT} both`,
      },
    },
  },
  plugins: [],
};
