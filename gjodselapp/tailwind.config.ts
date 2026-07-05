import type { Config } from 'tailwindcss';

// Fargene er definert som CSS-variabler i globals.css slik at
// mørk modus (prefers-color-scheme) styres ett sted.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg)',
        card: 'var(--card)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        primary: {
          DEFAULT: 'var(--primary)',
          soft: 'var(--primary-soft)',
        },
        warn: {
          DEFAULT: 'var(--warn)',
          soft: 'var(--warn-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          soft: 'var(--danger-soft)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
