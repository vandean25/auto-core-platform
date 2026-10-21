import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as salesApi from '@/api/sales'
import { deSales } from '@/test/de-sales'
import type { useInvoiceDraftAutosave } from './useInvoiceDraftAutosave'
import { useInvoiceFinalize } from './useInvoiceFinalize'

vi.mock('@/api/sales')
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

type Autosave = ReturnType<typeof useInvoiceDraftAutosave>
type FinalizeMutation = ReturnType<typeof salesApi.useFinalizeInvoice>

const autosaveWith = (overrides: Partial<Autosave> = {}): Autosave =>
  ({
    saveStatus: 'idle',
    buildPayload: vi.fn(() => ({ customerId: 'cust-1', items: [], notes: undefined })),
    clearPendingSave: vi.fn(),
    abortInFlightSave: vi.fn(),
    ...overrides,
  }) as unknown as Autosave

const mockFinalize = (isPending: boolean) =>
  vi.mocked(salesApi.useFinalizeInvoice).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending,
  } as unknown as FinalizeMutation)

const renderFinalize = ({ hasCustomer = true, autosave = autosaveWith() } = {}) => {
  const queryClient = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return renderHook(
    () =>
      useInvoiceFinalize({
        invoiceId: 'inv-1',
        hasCustomer,
        autosave,
        updateInvoiceMutation: { mutateAsync: vi.fn() } as unknown as ReturnType<typeof salesApi.useUpdateInvoice>,
      }),
    { wrapper },
  )
}

describe('useInvoiceFinalize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFinalize(false)
  })

  it('opens the dialog and closes it again when it is dismissed', () => {
    const { result } = renderFinalize()

    act(() => {
      result.current.openDialog()
    })
    expect(result.current.open).toBe(true)

    act(() => {
      result.current.handleOpenChange(false)
    })
    expect(result.current.open).toBe(false)
  })

  it('reports a missing customer and does not finalize', () => {
    const { result } = renderFinalize({ hasCustomer: false })

    act(() => {
      result.current.confirm()
    })

    expect(toast.error).toHaveBeenCalledWith(deSales.finalize.missingCustomer)
  })

  it('does not finalize while a draft save is still running', () => {
    const { result } = renderFinalize({ autosave: autosaveWith({ saveStatus: 'saving' }) })

    act(() => {
      result.current.confirm()
    })

    expect(toast.error).toHaveBeenCalledWith(deSales.finalize.saving)
  })

  it('reports busy while the finalize request is pending', () => {
    mockFinalize(true)

    const { result } = renderFinalize()

    expect(result.current.isFinalizeBusy).toBe(true)
    expect(result.current.isFinalizing).toBe(false)
  })
})
