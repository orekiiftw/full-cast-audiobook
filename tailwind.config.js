/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        cinema: {
          950: "#101916",
          900: "#16221d",
          850: "#1b2822",
          800: "#223129",
          700: "#31443a",
          600: "#536b5d",
          500: "#819689",
          400: "#a1b1a6",
          300: "#c0ccc2",
          200: "#dce2d7",
          100: "#f5f2e9",
        },
        gold: {
          50: "#fafbf3",
          100: "#edf2db",
          200: "#e1e9c5",
          300: "#d4e1ac",
          400: "#c5d697",
          500: "#b7ca82",
          600: "#8ea661",
          700: "#6c8349",
          800: "#4c6136",
          900: "#34472a",
          950: "#1c2d1a",
        },
        mist: {
          400: "#a8a4c0",
          500: "#7c7898",
        },
      },
      fontFamily: {
        serif: ['"Fraunces"', '"Playfair Display"', "Georgia", "serif"],
        sans: ['"DM Sans"', "Inter", "system-ui", "-apple-system", "sans-serif"],
        display: ['"DM Sans"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 4px 24px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(255,255,255,0.03) inset",
        elevated: "0 24px 64px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(255,255,255,0.04) inset",
        glow: "0 0 40px rgba(196, 146, 62, 0.18)",
        "glow-sm": "0 0 16px rgba(196, 146, 62, 0.28)",
        "glow-soft": "0 0 80px rgba(196, 146, 62, 0.08)",
        player: "0 -8px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.04)",
        cover: "0 20px 50px rgba(0,0,0,0.55), 0 8px 16px rgba(0,0,0,0.35)",
      },
      backgroundImage: {
        "mesh-gold":
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(196,146,62,0.12), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(120,90,200,0.06), transparent), radial-gradient(ellipse 50% 30% at 0% 100%, rgba(196,146,62,0.05), transparent)",
        "cover-sheen": "linear-gradient(145deg, rgba(255,255,255,0.08) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.2) 100%)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "fade-up": "fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-soft": "pulse-soft 2.8s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      borderRadius: {
        "2.5xl": "1.25rem",
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
};
