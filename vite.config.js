import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:7000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
