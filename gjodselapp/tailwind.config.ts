import type { Config } from 'tailwindcss';

// EGGLY-paletten – definert som CSS-variabler i globals.css (mørkt tema).
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg)',
        elev: 'var(--bg-elev)',
        card: {
          DEFAULT: 'var(--card)',
          2: 'var(--card-2)',
        },
        line: 'var(--line)',
        linestrong: 'var(--linestrong)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        dim: 'var(--dim)',
        primary: {
          DEFAULT: 'var(--primary)',
          press: 'var(--primary-press)',
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
        cyan: {
          DEFAULT: 'var(--cyan)',
          soft: 'var(--cyan-soft)',
        },
        violet: 'var(--violet)',
      },
    },
  },
  plugins: [],
};

export default config;
