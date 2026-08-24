import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En GitHub Pages la app se sirve desde /mapteaching/ (repo de usuario, no de
// organización). GITHUB_PAGES lo setea el workflow de deploy; en dev/build
// local queda en '/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES ? '/mapteaching/' : '/',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
})
