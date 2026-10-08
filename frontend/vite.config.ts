import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev-only: allow HTTPS tunnels (ngrok / Cloudflare quick tunnel) used to
    // expose the local Mini App to real Telegram clients during development.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.trycloudflare.com'],
  },
})
