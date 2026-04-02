import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const hasSentryUploadCredentials = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
)

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(hasSentryUploadCredentials
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG!,
            project: process.env.SENTRY_PROJECT!,
            authToken: process.env.SENTRY_AUTH_TOKEN!,
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: 'hidden',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
