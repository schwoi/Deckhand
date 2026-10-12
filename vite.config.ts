import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': r('./shared'), '@': r('./web/src') } },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5180,
    proxy: {
      '/api': { target: process.env.DECKHAND_API || 'http://127.0.0.1:4800', changeOrigin: true },
    },
  },
})
