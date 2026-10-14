import * as React from 'react'
import * as Sentry from '@sentry/react'
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom'
import { createSentryOptions } from '@/sentry/config'

const baseOptions = createSentryOptions(import.meta.env)

// The approval page carries its token in the URL. It sends no replay, breadcrumbs or traces (ADR-0025 §7).
const isPublicApprovalPage = window.location.pathname.startsWith('/approve/')

if (baseOptions.dsn && !isPublicApprovalPage) {
  Sentry.init({
    ...baseOptions,
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
  })
}
