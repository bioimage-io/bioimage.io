/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ri-orange': '#f39200',
        'ri-black': '#000000',
        'ri-white': '#ffffff',
        // Override standard colors to lean toward the strict branding
        blue: {
          50: '#f9f9f9', // Replace light blues with neutral
          100: '#f5f5f5',
          600: '#f39200', // Map primary action blue to orange
          700: '#d98300', // Darker orange for hover
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        '1400': '1400px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms')({
      strategy: 'class', // only generate classes
    }),
    require('@tailwindcss/line-clamp'),
    require('@tailwindcss/typography'),
  ],
}