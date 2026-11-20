/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        p2p: {
          bg: '#000000',
          surface: '#151515',
          accent: '#FF5A00',
          ink: '#FFFFFF',
          muted: 'rgba(255, 255, 255, 0.60)',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-active': 'rgba(255, 90, 0, 0.45)',
          tint: 'rgba(255, 90, 0, 0.12)',
        },
      },
      fontFamily: {
        p2p: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        'p2p-mono': ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}

