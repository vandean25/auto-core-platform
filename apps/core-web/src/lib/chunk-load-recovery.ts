import * as Sentry from '@sentry/react'

export const CHUNK_RELOAD_STORAGE_KEY = 'acp:chunk-reload-at'
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000

export type ChunkLoadRecoveryMechanism = 'vite_preload' | 'lazy_import' | 'error_boundary'

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const err = error as { name?: string; message?: string }
  return (
    err.name === 'ChunkLoadError' ||
    (typeof err.message === 'string' &&
      (err.message.includes('Failed to fetch dynamically imported module') ||
        err.message.includes('Importing a module script failed')))
  )
}

export function getChunkReloadCooldownRemainingMs(now = Date.now()): number {
  if (typeof sessionStorage === 'undefined') {
    return 0
  }

  const raw = sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)
  if (!raw) {
    return 0
  }

  const lastReloadAt = Number.parseInt(raw, 10)
  if (!Number.isFinite(lastReloadAt)) {
    return 0
  }

  const elapsed = now - lastReloadAt
  return Math.max(0, CHUNK_RELOAD_COOLDOWN_MS - elapsed)
}

export function canReloadForStaleChunk(now = Date.now()): boolean {
  return getChunkReloadCooldownRemainingMs(now) === 0
}

export function markChunkReloadAttempt(now = Date.now()): void {
  if (typeof sessionStorage === 'undefined') {
    return
  }
  sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now))
}

/**
 * Performs at most one hard reload per cooldown window to recover stale Vite chunks.
 * Returns true when a reload was scheduled.
 */
export function tryReloadForStaleChunk(_reason: ChunkLoadRecoveryMechanism): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  if (!canReloadForStaleChunk()) {
    return false
  }

  markChunkReloadAttempt()
  chunkLoadRecoveryActions.reloadPage()
  return true
}

export const chunkLoadRecoveryActions = {
  reloadPage(): void {
    window.location.reload()
  },
}

export function reloadPage(): void {
  chunkLoadRecoveryActions.reloadPage()
}

export function captureChunkLoadRecovered(
  error: unknown,
  mechanism: ChunkLoadRecoveryMechanism,
): void {
  Sentry.withScope((scope) => {
    scope.setTag('chunk_load_recovered', 'true')
    scope.setContext('chunk_load_recovery', { mechanism })
    if (error instanceof Error) {
      Sentry.captureException(error)
      return
    }
    Sentry.captureMessage('Chunk load recovery', {
      level: 'warning',
      extra: { error, mechanism },
    })
  })
}

let vitePreloadHandlerRegistered = false

export function registerVitePreloadErrorHandler(): void {
  if (vitePreloadHandlerRegistered || typeof window === 'undefined') {
    return
  }

  vitePreloadHandlerRegistered = true

  window.addEventListener('vite:preloadError', (event) => {
    const preloadEvent = event as Event & {
      payload?: unknown
      detail?: { payload?: unknown }
    }
    const error = preloadEvent.payload ?? preloadEvent.detail?.payload

    if (!isChunkLoadError(error)) {
      return
    }

    captureChunkLoadRecovered(error, 'vite_preload')

    if (tryReloadForStaleChunk('vite_preload')) {
      event.preventDefault()
    }
  })
}
