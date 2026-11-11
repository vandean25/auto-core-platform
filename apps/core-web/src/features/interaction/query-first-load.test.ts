import { describe, expect, it } from 'vitest'

import { isAwaitingFirstQueryPayload } from './query-first-load'

describe('isAwaitingFirstQueryPayload', () => {
  it('is true only while pending and payload is not ready', () => {
    expect(isAwaitingFirstQueryPayload(true, false)).toBe(true)
    expect(isAwaitingFirstQueryPayload(true, true)).toBe(false)
    expect(isAwaitingFirstQueryPayload(false, false)).toBe(false)
  })

  it('AUT-971: is false for paused pending (not actively fetching)', () => {
    expect(isAwaitingFirstQueryPayload(true, false, false)).toBe(false)
  })
})
