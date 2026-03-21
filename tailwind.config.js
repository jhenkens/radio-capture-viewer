/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/client/**/*.{ts,html}", "./dist/public/**/*.html"],
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/forms")],
};
