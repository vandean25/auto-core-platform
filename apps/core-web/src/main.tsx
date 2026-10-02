import './instrument'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { reactErrorHandler } from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/auth/AuthProvider'
import { isChunkLoadError, registerVitePreloadErrorHandler } from '@/lib/chunk-load-recovery'

registerVitePreloadErrorHandler()

const sentryUncaughtErrorHandler = reactErrorHandler()
const sentryCaughtErrorHandler = reactErrorHandler()
const sentryRecoverableErrorHandler = reactErrorHandler()

function shouldSkipSentryChunkNoise(error: unknown): boolean {
  return isChunkLoadError(error)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, errorInfo) => {
    if (shouldSkipSentryChunkNoise(error)) {
      return
    }
    sentryUncaughtErrorHandler(error, errorInfo)
  },
  onCaughtError: (error, errorInfo) => {
    if (shouldSkipSentryChunkNoise(error)) {
      return
    }
    sentryCaughtErrorHandler(error, errorInfo)
  },
  onRecoverableError: (error, errorInfo) => {
    if (shouldSkipSentryChunkNoise(error)) {
      return
    }
    sentryRecoverableErrorHandler(error, errorInfo)
  },
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
