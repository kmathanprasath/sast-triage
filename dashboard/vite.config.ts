import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const SCANNER_URL      = process.env.SCANNER_URL      || 'http://localhost:5000'
const INTELLIGENCE_URL = process.env.INTELLIGENCE_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api/scanner': {
        target: SCANNER_URL,
        rewrite: path => path.replace(/^\/api\/scanner/, ''),
        changeOrigin: true,
      },
      '/api/intelligence': {
        target: INTELLIGENCE_URL,
        rewrite: path => path.replace(/^\/api\/intelligence/, ''),
        changeOrigin: true,
      },
    }
  }
})
