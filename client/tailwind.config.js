/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Colors taken from the IWMPC logo: blue for navigation and main buttons,
        // yellow and red as accents. (Status colors green / yellow / red are separate.)
        brand: {
          50: '#eef0ff',
          100: '#dfe2ff',
          200: '#c0c5ff',
          500: '#2d32cf',
          600: '#1616b4',
          700: '#000099',
          800: '#00007f',
          900: '#000061',
          // Deep navy for the side menu.
          950: '#070a3d',
        },
        logo: {
          yellow: '#ffed05',
          red: '#f70903',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
