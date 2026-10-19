import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Older Safari (14-15, e.g. on 2013-2015 MacBooks) is still in use: compile for it instead of the newest browsers only.
    target: ['es2020', 'safari14', 'chrome87', 'firefox78', 'edge88'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Dev-only: allow HTTPS tunnels (ngrok / Cloudflare quick tunnel) when
    // showing the local site to someone else (e.g. on a phone).
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.trycloudflare.com'],
  },
})
