import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/docs': { target: 'http://localhost:8000', changeOrigin: true },
      '/redoc': { target: 'http://localhost:8000', changeOrigin: true },
      '/swagger': { target: 'http://localhost:8000', changeOrigin: true },
      '/openapi.json': { target: 'http://localhost:8000', changeOrigin: true },
      '/connect': { target: 'http://localhost:8000', changeOrigin: true },
      '/authorize': { target: 'http://localhost:8000', changeOrigin: true },
      '/.well-known': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
