import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ['**/llama.cpp/**', '**/models/**', '**/.git/**']
    }
  },
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.{js,jsx,ts,tsx}'],
    exclude: ['llama.cpp']
  },
  build: {
    rollupOptions: {
      external: ['llama.cpp']
    }
  }
})
