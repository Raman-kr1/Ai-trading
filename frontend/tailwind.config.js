/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0f172a',
          panel: '#111c33',
          raised: '#172238',
          border: '#1f2c47',
        },
        accent: {
          buy: '#10b981',
          sell: '#ef4444',
          hold: '#f59e0b',
          info: '#38bdf8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-fast': 'pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flash-up': 'flash-up 0.8s ease-out',
        'flash-down': 'flash-down 0.8s ease-out',
      },
      keyframes: {
        'flash-up': {
          '0%': { backgroundColor: 'rgba(16,185,129,0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'flash-down': {
          '0%': { backgroundColor: 'rgba(239,68,68,0.35)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
    },
  },
  plugins: [],
};
