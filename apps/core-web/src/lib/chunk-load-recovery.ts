import * as Sentry from '@sentry/react'

export const CHUNK_RELOAD_STORAGE_KEY = 'acp:chunk-reload-at'
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000

export type ChunkLoadRecoveryMechanism = 'vite_preload' | 'lazy_import' | 'error_boundary'

export const chunkReloadState = {
  reloadScheduled: false,
}

export function isChunkReloadScheduled(): boolean {
  return chunkReloadState.reloadScheduled
}

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const err = error as { name?: string; message?: string }
  return (
    err.name === 'ChunkLoadError' ||
    (typeof err.message === 'string' &&
      (err.message.includes('Failed to fetch dynamically imported module') ||
        err.message.includes('error loading dynamically imported module') ||
        err.message.includes('Importing a module script failed')))
  )
}

function readLastReloadTimestamp(): number | null {
  if (typeof sessionStorage === 'undefined') {
    return null
  }

  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const lastReloadAt = Number.parseInt(raw, 10)
    return Number.isFinite(lastReloadAt) ? lastReloadAt : null
  } catch {
    return null
  }
}

export function getChunkReloadCooldownRemainingMs(now = Date.now()): number {
  const lastReloadAt = readLastReloadTimestamp()
  if (lastReloadAt === null) {
    return 0
  }

  const elapsed = now - lastReloadAt
  return Math.max(0, CHUNK_RELOAD_COOLDOWN_MS - elapsed)
}

export function canReloadForStaleChunk(now = Date.now()): boolean {
  return getChunkReloadCooldownRemainingMs(now) === 0
}

export function markChunkReloadAttempt(now = Date.now()): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false
  }

  try {
    sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/**
 * Performs at most one hard reload per cooldown window to recover stale Vite chunks.
 * Returns true when a reload was scheduled.
 */
export function tryReloadForStaleChunk(
  reason: ChunkLoadRecoveryMechanism,
  error?: unknown,
): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  if (!canReloadForStaleChunk()) {
    return false
  }

  if (!markChunkReloadAttempt()) {
    return false
  }

  chunkReloadState.reloadScheduled = true
  Sentry.addBreadcrumb({
    category: 'chunk-reload',
    message: 'Scheduling stale chunk reload',
    data: { reason },
  })

  if (error !== undefined) {
    captureChunkLoadRecovered(error, reason)
  }

  chunkLoadRecoveryActions.reloadPage()
  return true
}

export const chunkLoadRecoveryActions = {
  reloadPage(): void {
    window.location.reload()
  },
}

export function captureChunkLoadRecovered(
  error: unknown,
  mechanism: ChunkLoadRecoveryMechanism,
): void {
  Sentry.withScope((scope) => {
    scope.setTag('chunk_load_recovered', 'true')
    scope.setFingerprint(['chunk-load-recovered', mechanism])
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
    try {
      const preloadEvent = event as Event & {
        payload?: unknown
        detail?: { payload?: unknown }
      }
      const error = preloadEvent.payload ?? preloadEvent.detail?.payload

      if (!isChunkLoadError(error)) {
        return
      }

      if (tryReloadForStaleChunk('vite_preload', error)) {
        event.preventDefault()
      }
    } catch {
      // Never let listener exceptions skip recovery paths elsewhere.
    }
  })
}
