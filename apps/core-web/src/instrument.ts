import * as React from 'react'
import * as Sentry from '@sentry/react'
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom'
import { isChunkLoadError } from '@/lib/chunk-load-recovery'
import { createSentryOptions } from '@/sentry/config'

const baseOptions = createSentryOptions(import.meta.env)

if (baseOptions.dsn) {
  Sentry.init({
    ...baseOptions,
    beforeSend(event, hint) {
      const original = hint.originalException
      if (isChunkLoadError(original) && event.tags?.chunk_load_recovered !== 'true') {
        return null
      }
      return event
    },
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
