import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_APP_URL || ''

  return {
    plugins: [react()],
    server: {
      port: 5173,
      ...(apiTarget ? {
        proxy: {
          '/api': {
            target: apiTarget,
            changeOrigin: true,
            secure: apiTarget.startsWith('https'),
          }
        }
      } : {})
    },
    preview: { port: 5174 }
  }
})