import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sentryMocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
}))

vi.mock('@sentry/react', () => ({
  addBreadcrumb: sentryMocks.addBreadcrumb,
}))

import * as chunkLoadRecovery from './chunk-load-recovery'

describe('chunk-load-recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
    chunkLoadRecovery.chunkReloadState.reloadScheduled = false
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
    expect(sentryMocks.addBreadcrumb).toHaveBeenCalled()
    expect(chunkLoadRecovery.isChunkReloadScheduled()).toBe(true)
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
  })

  it('does not reload from preload when cooldown is active', () => {
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
