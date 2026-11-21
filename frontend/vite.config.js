import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // Path the app is served from. "/" normally; "/banking-platform/" on GitHub Pages
    // (set by .github/workflows/deploy-frontend.yml through VITE_BASE).
    base: env.VITE_BASE || '/',
    plugins: [react()],
    server: {
      port: 5173,
      open: true,
      // In dev, the browser calls /api/... on :5173 and Vite forwards it to the
      // API gateway, so no CORS setup is needed. Override with VITE_PROXY_TARGET.
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
