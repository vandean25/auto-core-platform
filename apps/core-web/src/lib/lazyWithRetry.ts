import * as React from 'react'
import {
  captureChunkLoadRecovered,
  isChunkLoadError,
  tryReloadForStaleChunk,
} from '@/lib/chunk-load-recovery'

type LazyModule<T extends React.ComponentType<unknown>> = () => Promise<{ default: T }>

/**
 * React.lazy wrapper that retries a failed dynamic import once, then triggers the
 * guarded stale-chunk reload handler before surfacing the error to the boundary.
 */
export function lazyWithRetry<T extends React.ComponentType<unknown>>(factory: LazyModule<T>) {
  return React.lazy(async () => {
    const load = async (attempt: 'initial' | 'retry'): Promise<{ default: T }> => {
      try {
        return await factory()
      } catch (error) {
        if (!isChunkLoadError(error)) {
          throw error
        }

        if (attempt === 'initial') {
          return load('retry')
        }

        captureChunkLoadRecovered(error, 'lazy_import')

        if (tryReloadForStaleChunk('lazy_import')) {
          return new Promise(() => {})
        }

        throw error
      }
    }

    return load('initial')
  })
}
