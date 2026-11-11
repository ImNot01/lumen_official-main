/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effefb', 100: '#c8fff4', 200: '#91fee8', 300: '#53f3d7', 400: '#20dfc3',
          500: '#07c3aa', 600: '#039f8d', 700: '#077f73', 800: '#0c645d', 900: '#0f524d',
        },
      },
    },
  },
  plugins: [],
}
