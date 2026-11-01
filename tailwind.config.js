/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        plw: {
          deep: '#071A33',
          navy: '#0B2547',
          gold: '#B98C2C',
          'gold-soft': '#D8AE55',
          ivory: '#F4F2ED',
          white: '#FFFFFF',
          ink: '#0A1826',
        },
        success: {
          50: '#ECFDF3',
          100: '#D1FADF',
          500: '#16A34A',
          600: '#15803D',
          700: '#166534',
        },
        danger: {
          50: '#FEF3F2',
          100: '#FEE4E2',
          500: '#DC2626',
          600: '#B42318',
          700: '#912018',
        },
        warning: {
          50: '#FFFAEB',
          100: '#FEF0C7',
          600: '#B54708',
          700: '#93370D',
        },
        neutral: {
          50: '#F8F9FA',
          100: '#F1F3F5',
          200: '#E3E7EC',
          300: '#CBD2DA',
          400: '#8A94A3',
          500: '#667085',
          600: '#4B5565',
          700: '#344054',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(10, 24, 38, 0.06), 0 4px 16px rgba(10, 24, 38, 0.05)',
        raised: '0 8px 24px rgba(10, 24, 38, 0.12)',
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
