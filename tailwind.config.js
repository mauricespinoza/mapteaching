/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070b16',
          900: '#0b1020',
          800: '#121a2e',
          700: '#1b2540',
          600: '#26324f',
          500: '#38466a',
        },
      },
    },
  },
  plugins: [],
}
