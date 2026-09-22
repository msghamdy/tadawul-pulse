/** @type {import('tailwindcss').Config} */
// Colours come from CSS variables in src/styles/theme.css; edit them there.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    borderRadius: { none: "0", DEFAULT: "0" },
    extend: {
      colors: {
        bg: v("bg"),
        border: v("border"),
        grid: v("grid"),
        titlebar: v("titlebar"),
        menu: v("menu"),
        hover: v("hover"),
        select: v("select"),
        amber: v("amber"),
        text: v("text"),
        dim: v("dim"),
        muted: v("muted"),
        yellow: v("yellow"),
        up: v("up"),
        down: v("down"),
        flat: v("flat"),
        oil: v("oil"),
        mkt: v("mkt"),
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', '"IBM Plex Sans Arabic"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["10.5px", "1.3"],
        xs: ["11px", "1.35"],
        sm: ["12px", "1.35"],
        base: ["13px", "1.4"],
      },
    },
  },
  plugins: [],
};
