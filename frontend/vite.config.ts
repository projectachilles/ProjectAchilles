import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

const BACKEND_PORT = process.env.VITE_BACKEND_PORT || '3000'

export default defineConfig({
  plugins: [
    react(),
    // Bundle analysis: run with ANALYZE=true npm run build
    ...(process.env.ANALYZE ? [visualizer({
      filename: 'bundle-report.html',
      template: 'treemap',
      gzipSize: true,
      open: true,
    })] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) {
            return 'vendor-charts';
          }
          if (id.includes('node_modules/@clerk/')) {
            return 'vendor-clerk';
          }
          if (id.includes('node_modules/@radix-ui/')) {
            return 'vendor-ui';
          }
          if (id.includes('node_modules/react-syntax-highlighter') || id.includes('node_modules/react-markdown') || id.includes('node_modules/remark-gfm')) {
            return 'vendor-code';
          }
        },
      },
    },
  },
  server: {
    allowedHosts: ['localhost', '.ngrok.app', '.ngrok-free.app', '.railway.app', '.onrender.com'],
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
    allowedHosts: ['localhost', '.ngrok.app', '.ngrok-free.app', '.railway.app', '.onrender.com'],
  },
})
