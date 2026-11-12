/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // One brand color, used for navigation and main buttons.
        brand: {
          50: '#eef6fb',
          100: '#d8eaf5',
          200: '#b3d5ea',
          500: '#1f7fb5',
          600: '#156a9c',
          700: '#12557e',
          800: '#113f5c',
          900: '#0e2f45',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
