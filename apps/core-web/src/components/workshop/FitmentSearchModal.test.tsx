import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import * as catalogExternal from '@/api/catalog-external'
import type { CatalogExternalSearchResponse } from '@/api/types'
import { FitmentSearchModal } from './FitmentSearchModal'

vi.mock('@/api/catalog-external')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const onOpenChange = vi.fn()
const onSearchSessionUpdate = vi.fn()
const onRequestResolveIdentity = vi.fn()

const defaultProps = {
  open: true,
  onOpenChange,
  workshopOrderId: 'order-1',
  taskId: 'task-1',
  vehicleId: 'vehicle-1',
  oemConcernCode: 'STELLANTIS' as const,
  isIdentityStale: false,
  onSearchSessionUpdate,
  onRequestResolveIdentity,
}

const oemPartsHit: CatalogExternalSearchResponse = {
  concern: 'PARTS',
  sourceUsed: 'OEM',
  oemStatus: 'HIT',
  fallbackRequired: false,
  fallbackReason: null,
  retryOemAvailable: true,
  items: [
    {
      externalId: 'oem-1',
      sourceSystem: 'stellantis',
      name: 'Brake Pad',
      articleNumber: 'BP-1',
      brandLabel: 'OEM',
      unitPrice: 10,
      hitToken: 'token-oem',
    },
  ],
}

const aftermarketPartsHit: CatalogExternalSearchResponse = {
  concern: 'PARTS',
  sourceUsed: 'AFTERMARKET',
  oemStatus: 'EMPTY',
  fallbackRequired: false,
  fallbackReason: 'EMPTY',
  retryOemAvailable: true,
  items: [
    {
      externalId: 'am-1',
      sourceSystem: 'tecdoc',
      name: 'Filter Element',
      articleNumber: 'F-1',
      brandLabel: 'Aftermarket',
      unitPrice: 5,
      hitToken: 'token-am',
    },
  ],
}

function fallbackResponse(
  fallbackReason: 'EMPTY' | 'ERROR',
): CatalogExternalSearchResponse {
  return {
    concern: 'PARTS',
    sourceUsed: 'OEM',
    oemStatus: fallbackReason,
    fallbackRequired: true,
    fallbackReason,
    retryOemAvailable: true,
    items: [],
  }
}

async function typePartsQuery(value: string) {
  const input = screen.getByTestId('fitment-search-input-parts')
  await act(async () => {
    fireEvent.change(input, { target: { value } })
    await vi.advanceTimersByTimeAsync(300)
  })
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('FitmentSearchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(catalogExternal.useCatalogAssemblyGroups).mockReturnValue({
      data: { groups: [] },
      isFetching: false,
    } as unknown as ReturnType<typeof catalogExternal.useCatalogAssemblyGroups>)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not render add-to-order controls', () => {
    render(<FitmentSearchModal {...defaultProps} />)

    expect(screen.queryByRole('button', { name: /add to order/i })).not.toBeInTheDocument()
    expect(screen.getByText(/No add-to-order in M1/i)).toBeInTheDocument()
  })

  it('shows stale identity banner and clears results on 409', async () => {
    vi.useFakeTimers()
    const apiError = new Error('Vehicle identity is stale') as Error & { status?: number }
    apiError.status = 409
    vi.mocked(catalogExternal.fetchExternalCatalogSearch).mockRejectedValueOnce(apiError)

    render(<FitmentSearchModal {...defaultProps} />)

    await typePartsQuery('brake')
    await flushPromises()

    expect(screen.getByText(/Re-resolve now/i)).toBeInTheDocument()
    expect(screen.queryByTestId('fitment-search-parts-result')).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(
      'Vehicle identity is stale. Re-resolve before searching.',
    )
  })

  it('shows EMPTY fallback dialog copy', async () => {
    vi.useFakeTimers()
    vi.mocked(catalogExternal.fetchExternalCatalogSearch).mockResolvedValueOnce(
      fallbackResponse('EMPTY'),
    )

    render(<FitmentSearchModal {...defaultProps} />)

    await typePartsQuery('missing-part')
    await flushPromises()

    expect(screen.getByText('No OEM results')).toBeInTheDocument()
  })

  it('shows ERROR fallback dialog copy', async () => {
    vi.useFakeTimers()
    vi.mocked(catalogExternal.fetchExternalCatalogSearch).mockResolvedValueOnce(
      fallbackResponse('ERROR'),
    )

    render(<FitmentSearchModal {...defaultProps} />)

    await typePartsQuery('broken-oem')
    await flushPromises()

    expect(screen.getByText('OEM catalog unavailable')).toBeInTheDocument()
  })

  it('retries with confirmFallback=true after confirming fallback dialog', async () => {
    vi.useFakeTimers()
    vi.mocked(catalogExternal.fetchExternalCatalogSearch)
      .mockResolvedValueOnce(fallbackResponse('EMPTY'))
      .mockResolvedValueOnce(aftermarketPartsHit)

    render(<FitmentSearchModal {...defaultProps} />)

    await typePartsQuery('missing-part')
    await flushPromises()

    expect(screen.getByText('No OEM results')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Search aftermarket' }))
    })
    await flushPromises()

    expect(catalogExternal.fetchExternalCatalogSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        confirmFallback: true,
        q: 'missing-part',
      }),
    )
    expect(screen.getByText('Filter Element')).toBeInTheDocument()
  })

  it('searches aftermarket when Search other source is clicked', async () => {
    vi.useFakeTimers()
    vi.mocked(catalogExternal.fetchExternalCatalogSearch)
      .mockResolvedValueOnce(oemPartsHit)
      .mockResolvedValueOnce(aftermarketPartsHit)

    render(<FitmentSearchModal {...defaultProps} />)

    await typePartsQuery('brake')
    await flushPromises()

    expect(screen.getByText('Brake Pad')).toBeInTheDocument()
    expect(screen.getByTestId('search-other-source-button')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('search-other-source-button'))
    })
    await flushPromises()

    expect(catalogExternal.fetchExternalCatalogSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'AFTERMARKET',
        q: 'brake',
      }),
    )
    expect(screen.getByText('Filter Element')).toBeInTheDocument()
  })

  it('clears previous OEM results when fallback is required for a new query', async () => {
    vi.useFakeTimers()
    vi.mocked(catalogExternal.fetchExternalCatalogSearch)
      .mockResolvedValueOnce(oemPartsHit)
      .mockResolvedValueOnce(fallbackResponse('EMPTY'))

    render(<FitmentSearchModal {...defaultProps} />)

    await typePartsQuery('brake')
    await flushPromises()

    expect(screen.getByText('Brake Pad')).toBeInTheDocument()
    expect(onSearchSessionUpdate).toHaveBeenCalledTimes(1)

    await typePartsQuery('missing-part')
    await flushPromises()

    expect(screen.getByText('No OEM results')).toBeInTheDocument()
    expect(screen.queryByText('Brake Pad')).not.toBeInTheDocument()
    expect(onSearchSessionUpdate).toHaveBeenCalledTimes(1)
  })

  it('ignores stale in-flight responses when the query changes', async () => {
    vi.useFakeTimers()

    let resolveSlow!: (value: CatalogExternalSearchResponse) => void
    let resolveFast!: (value: CatalogExternalSearchResponse) => void
    const slowPromise = new Promise<CatalogExternalSearchResponse>((resolve) => {
      resolveSlow = resolve
    })
    const fastPromise = new Promise<CatalogExternalSearchResponse>((resolve) => {
      resolveFast = resolve
    })

    vi.mocked(catalogExternal.fetchExternalCatalogSearch)
      .mockReturnValueOnce(slowPromise)
      .mockReturnValueOnce(fastPromise)

    render(<FitmentSearchModal {...defaultProps} />)

    const input = screen.getByTestId('fitment-search-input-parts')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'brake' } })
      await vi.advanceTimersByTimeAsync(300)
      fireEvent.change(input, { target: { value: 'filter' } })
      await vi.advanceTimersByTimeAsync(300)
    })

    await act(async () => {
      resolveFast(aftermarketPartsHit)
      await flushPromises()
    })

    expect(screen.getByText('Filter Element')).toBeInTheDocument()

    await act(async () => {
      resolveSlow(oemPartsHit)
      await flushPromises()
    })

    expect(screen.queryByText('Brake Pad')).not.toBeInTheDocument()
    expect(screen.getByText('Filter Element')).toBeInTheDocument()
  })

  it('calls onRequestResolveIdentity when Re-resolve now is clicked', () => {
    render(<FitmentSearchModal {...defaultProps} isIdentityStale />)

    fireEvent.click(screen.getByRole('button', { name: 'Re-resolve now' }))

    expect(onRequestResolveIdentity).toHaveBeenCalledTimes(1)
  })
})
