import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En GitHub Pages la app se sirve desde /mapteaching/ (repo de usuario, no de
// organización). GITHUB_PAGES lo setea el workflow de deploy; en dev/build
// local queda en '/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? '/mapteaching/' : '/',
  // Sello del build: se enseña en la Guía y sirve para saber qué versión está
  // viendo cada dispositivo cuando algo no cuadra.
  define: {
    __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
})
