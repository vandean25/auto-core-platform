import type { ErrorEvent } from '@sentry/react'
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

  it('uses VITE_SENTRY_ENVIRONMENT and sample rate overrides', () => {
    const options = createSentryOptions({
      MODE: 'production',
      VITE_SENTRY_ENVIRONMENT: 'qa',
      VITE_SENTRY_TRACES_SAMPLE_RATE: '1',
    })

    expect(options.environment).toBe('qa')
    expect(options.tracesSampleRate).toBe(1)
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

  it('drops force-closed delete-origin rejections in beforeSend and keeps unrelated errors', () => {
    const options = createSentryOptions({ MODE: 'production' })
    const forceClosed = {
      exception: {
        values: [
          {
            type: 'UnknownError',
            value: 'Connection is closing because of: Force close delete origin',
            mechanism: { type: 'auto.browser.global_handlers.onunhandledrejection', handled: false },
          },
        ],
      },
    } as unknown as ErrorEvent
    const unrelated = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'id')",
            mechanism: { type: 'auto.browser.global_handlers.onerror', handled: false },
          },
        ],
      },
    } as unknown as ErrorEvent

    expect(options.beforeSend?.(forceClosed, {})).toBeNull()
    expect(options.beforeSend?.(unrelated, {})).toBe(unrelated)
  })

  it('still tags chunk load errors in beforeSend', () => {
    const options = createSentryOptions({ MODE: 'production' })
    const event = options.beforeSend?.({ tags: {} } as unknown as ErrorEvent, {
      originalException: new TypeError('Failed to fetch dynamically imported module: /assets/a.js'),
    })

    expect(event).toMatchObject({ tags: { chunk_load_recovered: 'true' } })
  })
})
