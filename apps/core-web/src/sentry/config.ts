import type { BrowserOptions } from '@sentry/react'
import { applyChunkLoadRecoveryBeforeSend } from '@/sentry/chunk-load-before-send'
import { isForceCloseDeleteOriginRejection } from '@/sentry/force-close-delete-origin'

type SentryEnv = {
  MODE?: string
  VITE_SENTRY_DSN?: string
  VITE_APP_VERSION?: string
  VITE_API_BASE_URL?: string
  VITE_SENTRY_TRACES_SAMPLE_RATE?: string
  VITE_SENTRY_ENVIRONMENT?: string
}

const API_PATH_PROPAGATION_TARGET = /\/api(?:\/|$)/

export function createSentryOptions(env: SentryEnv): BrowserOptions {
  const dsn = env.VITE_SENTRY_DSN ?? ''
  const environment = env.VITE_SENTRY_ENVIRONMENT || (env.MODE ?? 'development')
  const mode = env.MODE ?? 'development'
  const release = env.VITE_APP_VERSION ?? undefined
  const configuredRate = Number(env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? (mode === 'production' ? 0.1 : 1))
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
    // v11 replaces sendDefaultPii. Keeps v10's browser data (User-Agent and Referer) and turns the rest off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent', 'referer'] }, response: false },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      frameContextLines: 7,
    },
    tracesSampleRate,
    tracePropagationTargets: propagationTargets,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend: (event, hint) => {
      if (isForceCloseDeleteOriginRejection(event)) {
        return null
      }
      return applyChunkLoadRecoveryBeforeSend(event, hint)
    },
  }
}
