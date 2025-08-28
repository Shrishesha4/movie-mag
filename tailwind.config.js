/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        'netflix-red': '#E50914',
        'netflix-black': '#141414',
      }
    },
  },
  plugins: [],
}
