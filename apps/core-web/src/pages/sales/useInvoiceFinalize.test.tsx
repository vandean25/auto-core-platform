import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as salesApi from '@/api/sales'
import { deSales } from '@/test/de-sales'
import type { useInvoiceDraftAutosave } from './useInvoiceDraftAutosave'
import { useInvoiceFinalize } from './useInvoiceFinalize'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})
vi.mock('@/api/sales')
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

type Autosave = ReturnType<typeof useInvoiceDraftAutosave>
type FinalizeMutation = ReturnType<typeof salesApi.useFinalizeInvoice>
type UpdateMutation = ReturnType<typeof salesApi.useUpdateInvoice>

const autosaveWith = (overrides: Partial<Autosave> = {}): Autosave =>
  ({
    saveStatus: 'idle',
    clearPendingSave: vi.fn(),
    abortInFlightSave: vi.fn(),
    ...overrides,
  }) as unknown as Autosave

const mockFinalize = (mutateAsync: ReturnType<typeof vi.fn>, isPending = false) =>
  vi.mocked(salesApi.useFinalizeInvoice).mockReturnValue({
    mutateAsync,
    isPending,
  } as unknown as FinalizeMutation)

const renderFinalize = ({
  hasCustomer = true,
  autosave = autosaveWith(),
  updateMutateAsync = vi.fn(),
}: {
  hasCustomer?: boolean
  autosave?: Autosave
  updateMutateAsync?: ReturnType<typeof vi.fn>
} = {}) => {
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
        buildPayload: () => ({ customerId: 'cust-1', items: [], notes: undefined }),
        updateInvoiceMutation: { mutateAsync: updateMutateAsync } as unknown as UpdateMutation,
      }),
    { wrapper },
  )
}

describe('useInvoiceFinalize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFinalize(vi.fn())
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

  it('reports a missing customer and neither saves nor finalizes', () => {
    const updateMutateAsync = vi.fn()
    const finalizeMutateAsync = vi.fn()
    mockFinalize(finalizeMutateAsync)
    const { result } = renderFinalize({ hasCustomer: false, updateMutateAsync })

    act(() => {
      result.current.confirm()
    })

    expect(toast.error).toHaveBeenCalledWith(deSales.finalize.missingCustomer)
    expect(updateMutateAsync).not.toHaveBeenCalled()
    expect(finalizeMutateAsync).not.toHaveBeenCalled()
  })

  it('neither saves nor finalizes while a draft save is still running', () => {
    const updateMutateAsync = vi.fn()
    const finalizeMutateAsync = vi.fn()
    mockFinalize(finalizeMutateAsync)
    const { result } = renderFinalize({
      autosave: autosaveWith({ saveStatus: 'saving' }),
      updateMutateAsync,
    })

    act(() => {
      result.current.confirm()
    })

    expect(toast.error).toHaveBeenCalledWith(deSales.finalize.saving)
    expect(updateMutateAsync).not.toHaveBeenCalled()
    expect(finalizeMutateAsync).not.toHaveBeenCalled()
  })

  it('saves the draft, finalizes it and opens the invoice', async () => {
    const autosave = autosaveWith()
    const updateMutateAsync = vi.fn().mockResolvedValue({})
    const finalizeMutateAsync = vi.fn().mockResolvedValue({
      id: 'inv-1',
      status: 'FINALIZED',
      invoice_number: 'RE-2026-0001',
    })
    mockFinalize(finalizeMutateAsync)
    const { result } = renderFinalize({ autosave, updateMutateAsync })

    act(() => {
      result.current.confirm()
    })

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-1')
    })
    expect(autosave.clearPendingSave).toHaveBeenCalled()
    expect(autosave.abortInFlightSave).toHaveBeenCalled()
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'inv-1',
      payload: expect.objectContaining({ customerId: 'cust-1' }),
    })
    expect(finalizeMutateAsync).toHaveBeenCalledWith('inv-1')
  })

  it('reports busy while the finalize request is pending', () => {
    mockFinalize(vi.fn(), true)

    const { result } = renderFinalize()

    expect(result.current.isFinalizeBusy).toBe(true)
    expect(result.current.isFinalizing).toBe(false)
  })
})
