import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as chunkLoadRecovery from './chunk-load-recovery'
import { lazyWithRetry } from './lazyWithRetry'

const chunkError = () =>
  new TypeError('Failed to fetch dynamically imported module: https://example/assets/Dashboard.js')

describe('lazyWithRetry', () => {
  beforeEach(() => {
    sessionStorage.clear()
    chunkLoadRecovery.chunkReloadState.reloadScheduled = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('retries the import once, then triggers a guarded reload', async () => {
    const factory = vi
      .fn<() => Promise<{ default: React.ComponentType }>>()
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(chunkError())

    const reload = vi
      .spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage')
      .mockImplementation(() => {})

    const LazyComponent = lazyWithRetry(factory)

    render(
      <React.Suspense fallback={<div>loading</div>}>
        <LazyComponent />
      </React.Suspense>,
    )

    await waitFor(() => {
      expect(factory).toHaveBeenCalledTimes(2)
    })

    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY)).not.toBeNull()
  })

  it('does not reload again when the cooldown guard is active', async () => {
    sessionStorage.setItem(chunkLoadRecovery.CHUNK_RELOAD_STORAGE_KEY, String(Date.now()))

    const factory = vi
      .fn<() => Promise<{ default: React.ComponentType }>>()
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(chunkError())

    const reload = vi
      .spyOn(chunkLoadRecovery.chunkLoadRecoveryActions, 'reloadPage')
      .mockImplementation(() => {})

    const LazyComponent = lazyWithRetry(factory)

    render(
      <React.Suspense fallback={<div>loading</div>}>
        <LazyComponent />
      </React.Suspense>,
    )

    await waitFor(() => {
      expect(factory).toHaveBeenCalledTimes(2)
    })

    expect(reload).not.toHaveBeenCalled()
  })

  it('waits instead of rendering when a reload is scheduled but the module is missing', async () => {
    chunkLoadRecovery.chunkReloadState.reloadScheduled = true

    const factory = vi.fn<() => Promise<{ default: React.ComponentType }>>().mockResolvedValue({} as {
      default: React.ComponentType
    })

    const LazyComponent = lazyWithRetry(factory)

    render(
      <React.Suspense fallback={<div>loading</div>}>
        <LazyComponent />
      </React.Suspense>,
    )

    await waitFor(() => {
      expect(factory).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByText('loading')).toBeInTheDocument()
  })
})
