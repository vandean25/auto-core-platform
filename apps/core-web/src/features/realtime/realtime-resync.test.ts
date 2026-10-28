import { describe, expect, it, vi } from 'vitest'
import { getRealtimeResyncQueryKeys } from './dashboard-entity-map'
import { createRealtimeResync, REALTIME_RESYNC_MIN_INTERVAL_MS } from './realtime-resync'

function setup() {
  let clock = 1_000_000
  let listener: (() => void) | undefined
  const visibilitySource = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: vi.fn((_type: string, handler: () => void) => {
      listener = handler
    }),
    removeEventListener: vi.fn(() => {
      listener = undefined
    }),
  }
  const invalidate = vi.fn()
  const reconnectSocket = vi.fn()
  const resync = createRealtimeResync({
    invalidate,
    reconnectSocket,
    now: () => clock,
    visibilitySource: visibilitySource as unknown as Document,
  })
  resync.start()

  return {
    resync,
    invalidate,
    reconnectSocket,
    visibilitySource,
    advance: (ms: number) => {
      clock += ms
    },
    fireVisibility: () => listener?.(),
  }
}

describe('createRealtimeResync', () => {
  const expectedCalls = getRealtimeResyncQueryKeys().length

  it('does nothing on the first connect', () => {
    const { resync, invalidate } = setup()

    resync.onConnect()

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('invalidates every realtime-backed key by its targeted prefix on a reconnect', () => {
    const { resync, invalidate } = setup()

    resync.onConnect()
    resync.onConnect()

    expect(invalidate).toHaveBeenCalledTimes(expectedCalls)
    for (const [queryKey] of invalidate.mock.calls) {
      expect(Array.isArray(queryKey)).toBe(true)
      expect(queryKey.length).toBeGreaterThan(0)
    }
  })

  it('resyncs and reconnects the socket when the tab becomes visible again', () => {
    const { invalidate, reconnectSocket, fireVisibility } = setup()

    fireVisibility()

    expect(reconnectSocket).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(expectedCalls)
  })

  it('ignores the tab being hidden', () => {
    const { invalidate, reconnectSocket, visibilitySource, fireVisibility } = setup()
    visibilitySource.visibilityState = 'hidden'

    fireVisibility()

    expect(reconnectSocket).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('catches up once when a reconnect and a visible tab arrive together, and again after the interval', () => {
    const { resync, invalidate, fireVisibility, advance } = setup()
    resync.onConnect()

    resync.onConnect()
    fireVisibility()
    expect(invalidate).toHaveBeenCalledTimes(expectedCalls)

    advance(REALTIME_RESYNC_MIN_INTERVAL_MS)
    fireVisibility()
    expect(invalidate).toHaveBeenCalledTimes(expectedCalls * 2)
  })

  it('stops listening to visibility when disposed', () => {
    const { resync, visibilitySource, fireVisibility, invalidate } = setup()

    resync.dispose()
    fireVisibility()

    expect(visibilitySource.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('getRealtimeResyncQueryKeys', () => {
  it('lists unique, non-empty prefixes and never the whole cache', () => {
    const keys = getRealtimeResyncQueryKeys()

    expect(keys.length).toBeGreaterThan(5)
    expect(keys.every((queryKey) => queryKey.length > 0)).toBe(true)
    expect(new Set(keys.map((queryKey) => JSON.stringify(queryKey))).size).toBe(keys.length)
    expect(keys).toContainEqual(['dashboard-widget-data'])
    expect(keys).toContainEqual(['auth-session'])
  })
})
