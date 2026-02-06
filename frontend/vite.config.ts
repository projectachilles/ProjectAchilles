import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '3000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: true, // Allow ngrok and custom domains
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
    },
  },
  preview: {
    port: parseInt(process.env.PORT || '5173'),
    host: '0.0.0.0', // Allow external connections (required for Railway)
    strictPort: false,
    allowedHosts: true, // Allow Railway and custom domains
  },
})
