import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => {
  const captureException = vi.fn(() => 'event-id')
  const captureMessage = vi.fn(() => 'event-id')
  const setTag = vi.fn()
  const setFingerprint = vi.fn()
  const setContext = vi.fn()
  const addBreadcrumb = vi.fn()
  const withScope = vi.fn(
    (callback: (scope: {
      setTag: typeof setTag
      setFingerprint: typeof setFingerprint
      setContext: typeof setContext
    }) => void) => {
      callback({ setTag, setFingerprint, setContext })
    },
  )

  return { captureException, captureMessage, setTag, setFingerprint, setContext, addBreadcrumb, withScope }
})

vi.mock('@sentry/react', () => ({
  captureException: sentryMocks.captureException,
  captureMessage: sentryMocks.captureMessage,
  withScope: sentryMocks.withScope,
  addBreadcrumb: sentryMocks.addBreadcrumb,
}))

import * as chunkLoadRecovery from './chunk-load-recovery'

describe('chunk-load-recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
    chunkLoadRecovery.chunkReloadState.reloadScheduled = false
    sentryMocks.captureException.mockClear()
    sentryMocks.captureMessage.mockClear()
    sentryMocks.withScope.mockClear()
    sentryMocks.setTag.mockClear()
    sentryMocks.setFingerprint.mockClear()
    sentryMocks.setContext.mockClear()
    sentryMocks.addBreadcrumb.mockClear()
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
    expect(
      chunkLoadRecovery.isChunkLoadError(
        new TypeError('error loading dynamically imported module: https://example/assets/x.js'),
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
    expect(sentryMocks.captureException).not.toHaveBeenCalled()
  })

  it('allows reload after the cooldown window elapses and captures once', () => {
    const reload = vi.spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage').mockImplementation(() => {})
    const now = Date.now()
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/a.js')
    sessionStorage.setItem(
      chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY,
      String(now - chunkLoadRecovery.CHUNK_RELOAD_COOLDOWN_MS - 1),
    )

    vi.spyOn(Date, 'now').mockReturnValue(now)

    expect(chunkLoadRecovery.tryReloadForStaleChunk('vite_preload', error)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY)).toBe(String(now))
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1)
    expect(sentryMocks.captureException).toHaveBeenCalledWith(error)
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['chunk-load-recovered', 'vite_preload'])
    expect(chunkLoadRecovery.isChunkReloadScheduled()).toBe(true)
  })

  it('tags Sentry recovery events with chunk_load_recovered', () => {
    const preloadError = new TypeError('Failed to fetch dynamically imported module: /assets/a.js')
    const lazyError = new TypeError('Importing a module script failed')

    chunkLoadRecovery.captureChunkLoadRecovered(preloadError, 'vite_preload')
    chunkLoadRecovery.captureChunkLoadRecovered(lazyError, 'lazy_import')

    expect(sentryMocks.withScope).toHaveBeenCalledTimes(2)
    expect(sentryMocks.setTag).toHaveBeenCalledWith('chunk_load_recovered', 'true')
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['chunk-load-recovered', 'vite_preload'])
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['chunk-load-recovered', 'lazy_import'])
    expect(sentryMocks.captureException).toHaveBeenCalledWith(preloadError)
    expect(sentryMocks.captureException).toHaveBeenCalledWith(lazyError)
  })

  it('reports a cooldown-blocked chunk failure exactly once', () => {
    sessionStorage.setItem(chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY, String(Date.now()))
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/b.js')

    expect(chunkLoadRecovery.tryReloadForStaleChunk('lazy_import', error)).toBe(false)
    expect(sentryMocks.captureException).not.toHaveBeenCalled()

    chunkLoadRecovery.captureChunkLoadRecovered(error, 'error_boundary')
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1)
    expect(sentryMocks.setFingerprint).toHaveBeenCalledWith(['chunk-load-recovered', 'error_boundary'])
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
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1)
  })

  it('does not capture or reload from preload when cooldown is active', () => {
    const reload = vi.spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage').mockImplementation(() => {})
    chunkLoadRecovery.registerVitePreloadErrorHandler()
    sessionStorage.setItem(chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY, String(Date.now()))

    const error = new TypeError('Failed to fetch dynamically imported module: /assets/c.js')
    const event = new Event('vite:preloadError') as Event & { payload?: Error; preventDefault: () => void }
    event.payload = error
    const preventDefault = vi.spyOn(event, 'preventDefault')

    window.dispatchEvent(event)

    expect(reload).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    expect(sentryMocks.captureException).not.toHaveBeenCalled()
  })

  it('treats blocked sessionStorage writes as an active cooldown', () => {
    const reload = vi.spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError', 'SecurityError')
    })

    expect(chunkLoadRecovery.tryReloadForStaleChunk('lazy_import')).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
