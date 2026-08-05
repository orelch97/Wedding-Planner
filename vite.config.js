import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // מאותו origin כמו האפליקציה, כדי שעוגיית SameSite=Strict תישלח בפיתוח.
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
})
