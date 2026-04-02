import type { BrowserOptions } from '@sentry/react'

type SentryEnv = {
  MODE?: string
  VITE_SENTRY_DSN?: string
  VITE_APP_VERSION?: string
}

export function createSentryOptions(env: SentryEnv): BrowserOptions {
  const dsn = env.VITE_SENTRY_DSN ?? ''
  const environment = env.MODE ?? 'development'
  const release = env.VITE_APP_VERSION ?? undefined

  return {
    dsn,
    environment,
    release,
    sendDefaultPii: true,
    tracesSampleRate: 1.0,
    tracePropagationTargets: ['localhost', /^https:\/\/yourapi\.io/],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    enableLogs: true,
  }
}
