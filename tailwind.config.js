/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        plw: {
          deep: '#06080C',
          navy: '#2F6BFF',
          gold: '#4D8DFF',
          'gold-soft': '#9CC2FF',
          ivory: '#0B0D11',
          white: '#FFFFFF',
          ink: '#EDF1F7',
          surface: '#161A21',
          'surface-strong': '#1D222B',
        },
        success: {
          50: '#0E2418',
          100: '#143421',
          500: '#22C55E',
          600: '#16A34A',
          700: '#86EFAC',
        },
        danger: {
          50: '#2A1214',
          100: '#3A1719',
          500: '#EF4444',
          600: '#DC2626',
          700: '#FCA5A5',
        },
        warning: {
          50: '#2B2111',
          100: '#3A2D14',
          600: '#F59E0B',
          700: '#FCD34D',
        },
        neutral: {
          50: '#101318',
          100: '#171B22',
          200: '#232937',
          300: '#303846',
          400: '#7A8394',
          500: '#9AA3B2',
          600: '#C0C7D2',
          700: '#DCE2EA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        panel: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 40px rgba(0, 0, 0, 0.4)',
        raised: 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 24px 80px rgba(0, 0, 0, 0.6)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-in-right': 'slide-in-right 220ms ease-out',
      },
    },
  },
  plugins: [],
};
