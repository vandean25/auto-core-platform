import './instrument'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { reactErrorHandler } from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/auth/AuthProvider'
import { registerVitePreloadErrorHandler } from '@/lib/chunk-load-recovery'
import {
  PUBLIC_APPROVAL_PATH_PREFIX,
  PublicEstimateApprovalRoot,
} from '@/pages/public/PublicEstimateApprovalRoot'

registerVitePreloadErrorHandler()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

// The customer approval link is public: it renders without AuthProvider, App or any auth bootstrap.
// The prefix matches in any letter case, as the server's route does. readApprovalToken slices by length, so the token keeps its case.
const isPublicApproval = window.location.pathname.toLowerCase().startsWith(PUBLIC_APPROVAL_PATH_PREFIX)

createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    {isPublicApproval ? (
      <PublicEstimateApprovalRoot />
    ) : (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    )}
  </StrictMode>,
)
