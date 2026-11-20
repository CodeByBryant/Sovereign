import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative URLs: the same build works at the root, under /Sovereign/ on GitHub Pages, and from
  // file:// inside the desktop shell.
  base: './',
  plugins: [react()],
  // The terrain worker imports other modules, so it is bundled as an ES module.
  worker: { format: 'es' },
  server: { host: '0.0.0.0', port: 5000, strictPort: true }
})
