import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    entry: 'electron/main/index.ts',
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    entry: 'electron/preload/index.ts',
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/ui'),
    publicDir: resolve(__dirname, 'public'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/ui')
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5000,
      strictPort: true
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/ui/index.html')
      }
    }
  }
})
