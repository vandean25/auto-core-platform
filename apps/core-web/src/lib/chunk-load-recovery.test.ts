import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => {
  const captureException = vi.fn(() => 'event-id')
  const captureMessage = vi.fn(() => 'event-id')
  const setTag = vi.fn()
  const setContext = vi.fn()
  const withScope = vi.fn(
    (callback: (scope: { setTag: typeof setTag; setContext: typeof setContext }) => void) => {
      callback({ setTag, setContext })
    },
  )

  return { captureException, captureMessage, setTag, setContext, withScope }
})

vi.mock('@sentry/react', () => sentryMocks)

import * as chunkLoadRecovery from './chunk-load-recovery'

describe('chunk-load-recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sentryMocks.captureException.mockClear()
    sentryMocks.captureMessage.mockClear()
    sentryMocks.withScope.mockClear()
    sentryMocks.setTag.mockClear()
    sentryMocks.setContext.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects dynamic import and chunk load errors', () => {
    expect(
      chunkLoadRecovery.isChunkLoadError(
        new TypeError('Failed to fetch dynamically imported module: https://example/assets/x.js'),
      ),
    ).toBe(true)
    expect(chunkLoadRecovery.isChunkLoadError({ name: 'ChunkLoadError', message: 'loading chunk 9 failed' })).toBe(
      true,
    )
    expect(chunkLoadRecovery.isChunkLoadError(new Error('Importing a module script failed'))).toBe(true)
    expect(chunkLoadRecovery.isChunkLoadError(new Error('unrelated'))).toBe(false)
  })

  it('blocks reload attempts inside the cooldown window', () => {
    const now = Date.now()
    sessionStorage.setItem(chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY, String(now - 5_000))
    const reload = vi.spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage').mockImplementation(() => {})

    expect(chunkLoadRecovery.canReloadForStaleChunk(now)).toBe(false)
    expect(chunkLoadRecovery.tryReloadForStaleChunk('lazy_import')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('allows reload after the cooldown window elapses', () => {
    const reload = vi.spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage').mockImplementation(() => {})
    const now = Date.now()
    sessionStorage.setItem(
      chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY,
      String(now - chunkLoadRecovery.CHUNK_RELOAD_COOLDOWN_MS - 1),
    )

    vi.spyOn(Date, 'now').mockReturnValue(now)

    expect(chunkLoadRecovery.tryReloadForStaleChunk('vite_preload')).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY)).toBe(String(now))
  })

  it('tags Sentry events for preload and lazy import recovery paths', () => {
    const preloadError = new TypeError('Failed to fetch dynamically imported module: /assets/a.js')
    const lazyError = new TypeError('Importing a module script failed')

    chunkLoadRecovery.captureChunkLoadRecovered(preloadError, 'vite_preload')
    chunkLoadRecovery.captureChunkLoadRecovered(lazyError, 'lazy_import')

    expect(sentryMocks.withScope).toHaveBeenCalledTimes(2)
    expect(sentryMocks.setTag).toHaveBeenCalledWith('chunk_load_recovered', 'true')
    expect(sentryMocks.captureException).toHaveBeenCalledWith(preloadError)
    expect(sentryMocks.captureException).toHaveBeenCalledWith(lazyError)
  })

  it('registers a vite preload handler that reloads once when allowed', () => {
    const reload = vi.spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage').mockImplementation(() => {})
    chunkLoadRecovery.registerVitePreloadErrorHandler()

    const error = new TypeError('Failed to fetch dynamically imported module: /assets/b.js')
    const event = new Event('vite:preloadError') as Event & { payload?: Error; preventDefault: () => void }
    event.payload = error
    const preventDefault = vi.spyOn(event, 'preventDefault')

    window.dispatchEvent(event)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalled()
    expect(sentryMocks.captureException).toHaveBeenCalledWith(error)
  })
})
