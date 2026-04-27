import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const hasSentryUploadCredentials = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000'

  return {
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
      chunkSizeWarningLimit: 750,
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
        '/socket.io': {
          target: apiProxyTarget,
          ws: true,
          rewrite: (socketPath) => socketPath.replace(/^\/socket\.io/, '/api/socket.io'),
        },
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
