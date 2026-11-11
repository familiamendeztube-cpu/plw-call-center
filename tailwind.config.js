/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Fills that carry white text (navy, navy-hover, success-600/800, danger-600/800) keep at
      // least 4.5:1. The 700 shades are light text colors for the dark theme, never fills: hover
      // fills go darker to 800. Amber is too light for white, so text on warning-600 is plw-deep.
      colors: {
        plw: {
          deep: '#06080C',
          navy: '#2A62F0',
          'navy-hover': '#2257DF',
          gold: '#4D8DFF',
          'gold-soft': '#9CC2FF',
          ivory: '#1B1F26',
          white: '#FFFFFF',
          ink: '#EDF1F7',
          surface: '#161A21',
          'surface-strong': '#1D222B',
        },
        success: {
          50: '#0E2418',
          100: '#143421',
          500: '#22C55E',
          600: '#15803D',
          700: '#86EFAC',
          800: '#166534',
        },
        danger: {
          50: '#2A1214',
          100: '#3A1719',
          500: '#EF4444',
          600: '#DC2626',
          700: '#FCA5A5',
          800: '#B91C1C',
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
          400: '#9DA6B5',
          500: '#A9B2C0',
          600: '#C0C7D2',
          700: '#DCE2EA',
        },
      },
      // On the dark theme the brand blue fails contrast as text (about 2.2:1 on the glass), so
      // text-plw-navy uses the light blue; bg-plw-navy and the borders keep the brand blue.
      textColor: {
        plw: { navy: '#9CC2FF' },
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
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-in-right': 'slide-in-right 220ms ease-out',
        'slide-in-left': 'slide-in-left 220ms ease-out',
      },
    },
  },
  plugins: [],
};
