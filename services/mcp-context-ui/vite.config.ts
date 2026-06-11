import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  server: {
    port: 8080,
    host: true,
    proxy: {
      '/api/v1': {
        target: 'http://mcp-context-manager:3001',
        changeOrigin: true
      },
      '/api': {
        target: 'http://mcp-context-manager:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
