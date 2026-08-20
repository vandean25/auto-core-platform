import type { BrowserOptions } from '@sentry/react'

type SentryEnv = {
  MODE?: string
  VITE_SENTRY_DSN?: string
  VITE_APP_VERSION?: string
  VITE_API_BASE_URL?: string
  VITE_SENTRY_TRACES_SAMPLE_RATE?: string
}

const API_PATH_PROPAGATION_TARGET = /\/api(?:\/|$)/

export function createSentryOptions(env: SentryEnv): BrowserOptions {
  const dsn = env.VITE_SENTRY_DSN ?? ''
  const environment = env.MODE ?? 'development'
  const release = env.VITE_APP_VERSION ?? undefined
  const configuredRate = Number(env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? (environment === 'production' ? 0.1 : 1))
  const tracesSampleRate = Number.isFinite(configuredRate) ? configuredRate : 0.1

  const apiBaseUrl = env.VITE_API_BASE_URL
  const propagationTargets: (string | RegExp)[] = ['localhost', API_PATH_PROPAGATION_TARGET]
  if (apiBaseUrl) {
    propagationTargets.push(apiBaseUrl)
  }

  return {
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    tracesSampleRate,
    tracePropagationTargets: propagationTargets,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    enableLogs: true,
  }
}
