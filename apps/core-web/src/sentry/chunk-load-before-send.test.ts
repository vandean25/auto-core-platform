import type { ErrorEvent } from '@sentry/react'
import { describe, expect, it } from 'vitest'
import { applyChunkLoadRecoveryBeforeSend } from './chunk-load-before-send'

describe('applyChunkLoadRecoveryBeforeSend', () => {
  it('tags chunk load errors with chunk_load_recovered and a dedicated fingerprint', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/a.js')
    const event = applyChunkLoadRecoveryBeforeSend({ tags: {} } as ErrorEvent, { originalException: error })

    expect(event?.tags?.chunk_load_recovered).toBe('true')
    expect(event?.fingerprint).toEqual(['chunk-load-recovered', 'client'])
  })

  it('leaves non-chunk errors unchanged', () => {
    const error = new Error('unrelated')
    const original = { tags: { area: 'app' } } as unknown as ErrorEvent
    const event = applyChunkLoadRecoveryBeforeSend(original, { originalException: error })

    expect(event).toBe(original)
    expect(event?.tags?.chunk_load_recovered).toBeUndefined()
  })

  it('does not re-tag events that are already tagged', () => {
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/b.js')
    const original = {
      tags: { chunk_load_recovered: 'true' },
      fingerprint: ['chunk-load-recovered', 'client'],
    } as unknown as ErrorEvent
    const event = applyChunkLoadRecoveryBeforeSend(original, { originalException: error })

    expect(event).toBe(original)
  })
})
