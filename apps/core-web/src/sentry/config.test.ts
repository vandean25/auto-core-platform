import { describe, expect, it } from 'vitest'
import { createSentryOptions } from './config'

describe('createSentryOptions', () => {
  it('builds options from provided env values', () => {
    const options = createSentryOptions({
      MODE: 'production',
      VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
      VITE_APP_VERSION: 'core-web@1.2.3',
      VITE_API_BASE_URL: 'https://api.example.com',
    })

    expect(options.dsn).toBe('https://public@example.ingest.sentry.io/123')
    expect(options.environment).toBe('production')
    expect(options.release).toBe('core-web@1.2.3')
    expect(options.sendDefaultPii).toBe(false)
    expect(options.tracesSampleRate).toBe(0.1)
    expect(options.tracePropagationTargets).toEqual([
      'localhost',
      /\/api(?:\/|$)/,
      'https://api.example.com',
    ])
    expect(options.replaysSessionSampleRate).toBe(0.1)
    expect(options.replaysOnErrorSampleRate).toBe(1)
    expect(options.enableLogs).toBe(true)
  })

  it('falls back to safe defaults when optional env is absent', () => {
    const options = createSentryOptions({})

    expect(options.dsn).toBe('')
    expect(options.environment).toBe('development')
    expect(options.release).toBeUndefined()
    expect(options.tracesSampleRate).toBe(1)
  })

  it('does not add an empty API base URL to trace propagation targets', () => {
    const options = createSentryOptions({
      MODE: 'production',
      VITE_API_BASE_URL: '',
    })

    expect(options.tracePropagationTargets).toEqual(['localhost', /\/api(?:\/|$)/])
  })
})
