import * as React from 'react'
import {
  isChunkLoadError,
  isChunkReloadScheduled,
  tryReloadForStaleChunk,
} from '@/lib/chunk-load-recovery'

type LazyModule<T extends React.ComponentType> = () => Promise<{ default: T }>

function waitForChunkReload<T extends React.ComponentType>(): Promise<{ default: T }> {
  return new Promise(() => {})
}

function shouldWaitForReloadInFlight<T extends React.ComponentType>(
  module: { default: T } | null | undefined,
): boolean {
  if (!isChunkReloadScheduled()) {
    return false
  }

  return module == null || module.default === undefined
}

/**
 * React.lazy wrapper that retries a failed dynamic import once, then triggers the
 * guarded stale-chunk reload handler before surfacing the error to the boundary.
 */
export function lazyWithRetry<T extends React.ComponentType>(factory: LazyModule<T>) {
  return React.lazy(async () => {
    const load = async (attempt: 'initial' | 'retry'): Promise<{ default: T }> => {
      try {
        const module = await factory()
        if (shouldWaitForReloadInFlight(module)) {
          return waitForChunkReload()
        }
        return module
      } catch (error) {
        if (isChunkReloadScheduled()) {
          return waitForChunkReload()
        }

        if (!isChunkLoadError(error)) {
          throw error
        }

        if (attempt === 'initial') {
          return load('retry')
        }

        if (tryReloadForStaleChunk('lazy_import')) {
          return waitForChunkReload()
        }

        throw error
      }
    }

    return load('initial')
  })
}
