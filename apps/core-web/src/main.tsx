import './instrument'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { reactErrorHandler } from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/auth/AuthProvider'
import { I18nProvider } from '@/lib/i18n'
import { registerVitePreloadErrorHandler } from '@/lib/chunk-load-recovery'
import { captureInstallPrompt } from '@/pwa/install-prompt'
import { registerServiceWorker } from '@/pwa/register-service-worker'
import { isPublicApprovalPath } from '@/lib/public-approval-path'
import { PublicEstimateApprovalRoot } from '@/pages/public/PublicEstimateApprovalRoot'

registerVitePreloadErrorHandler()
captureInstallPrompt()
registerServiceWorker()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

// The customer approval link is public: it renders without AuthProvider, App or any auth bootstrap.
const isPublicApproval = isPublicApprovalPath(window.location.pathname)

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    {isPublicApproval ? (
      <I18nProvider>
        <PublicEstimateApprovalRoot />
      </I18nProvider>
    ) : (
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </I18nProvider>
    )}
  </StrictMode>,
)
