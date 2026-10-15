/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          950: '#020817'
        },
        brand: {
          50: '#eff6ff',
          500: '#3b82f6',
          700: '#1d4ed8'
        },
        danger: {
          500: '#ef4444'
        },
        success: {
          500: '#22c55e'
        }
      }
    }
  },
  plugins: []
};
