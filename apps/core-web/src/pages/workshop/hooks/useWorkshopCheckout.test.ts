import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useWorkshopCheckout,
  buildInvoiceLineDiscountUpdates,
} from './useWorkshopCheckout'
import * as salesApi from '@/api/sales'
import * as invoicesApi from '@/api/invoices'
import { toast } from 'sonner'
import type { Invoice, WorkshopOrder } from '@/api/types'
import type { DiscountState } from './useWorkshopCalculations'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/api/sales')
vi.mock('@/api/invoices')
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('useWorkshopCheckout', () => {
  const mockCreateDraft = vi.fn()
  const mockIssueInvoice = vi.fn()
  const mockUpdateDiscount = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(salesApi.useInvoice).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof salesApi.useInvoice>)

    vi.mocked(invoicesApi.useCreateDraftInvoice).mockReturnValue({
      mutateAsync: mockCreateDraft,
      isPending: false,
    } as unknown as ReturnType<typeof invoicesApi.useCreateDraftInvoice>)

    vi.mocked(invoicesApi.useIssueInvoice).mockReturnValue({
      mutateAsync: mockIssueInvoice,
      isPending: false,
    } as unknown as ReturnType<typeof invoicesApi.useIssueInvoice>)

    vi.mocked(invoicesApi.useUpdateInvoiceDiscount).mockReturnValue({
      mutateAsync: mockUpdateDiscount,
      isPending: false,
    } as unknown as ReturnType<typeof invoicesApi.useUpdateInvoiceDiscount>)
  })

  describe('buildInvoiceLineDiscountUpdates', () => {
    it('returns empty array when overrides are empty', () => {
      const result = buildInvoiceLineDiscountUpdates({}, new Map(), [])
      expect(result).toEqual([])
    })

    it('maps line discount overrides to invoice line item updates', () => {
      const overrides: Record<string, DiscountState> = {
        'task-1:line-1': { type: 'PERCENTAGE', value: '10' },
        'task-1:line-2': { type: null, value: '' },
      }

      const rowMap = new Map([
        ['task-1:line-1', { lineItem: { id: 'line-1' } }],
        ['task-1:line-2', { lineItem: { id: 'line-2' } }],
      ])

      const invoiceItems = [
        {
          id: 'line-1',
          description: 'Part 1',
          quantity: '1',
          unit_price: '100',
          tax_rate: 21,
        },
        {
          id: 'line-2',
          description: 'Part 2',
          quantity: '1',
          unit_price: '50',
          tax_rate: 21,
        },
      ] as unknown as Invoice['items']

      const updates = buildInvoiceLineDiscountUpdates(
        overrides,
        rowMap,
        invoiceItems,
      )
      expect(updates).toHaveLength(2)
      expect(updates).toContainEqual({
        id: 'line-1',
        discountType: 'PERCENTAGE',
        discountValue: 10,
      })
      expect(updates).toContainEqual({
        id: 'line-2',
        discountType: null,
        discountValue: null,
      })
    })

    it('ignores rows not found in map or invoice items', () => {
      const overrides: Record<string, DiscountState> = {
        'task-1:missing': { type: 'PERCENTAGE', value: '10' },
      }
      const updates = buildInvoiceLineDiscountUpdates(overrides, new Map(), [])
      expect(updates).toEqual([])
    })
  })

  describe('hook behavior', () => {
    const baseOrder: WorkshopOrder = {
      id: 'order-1',
      order_number: 'WO-001',
      purpose: 'CUSTOMER_REPAIR',
      status: 'COMPLETED',
      customer_id: 'c-1',
      customer: {
        id: 'c-1',
        first_name: 'Jane',
        last_name: 'Doe',
        type: 'PRIVATE',
      },
      vehicle_id: 'v-1',
      vehicle: {
        id: 'v-1',
        year: 2021,
        make: 'VW',
        model: 'Golf',
        vin: 'VIN123',
        plate: 'XYZ-1',
      },
      odometer: 50000,
      fuel_level: 50,
      tasks: [
        {
          id: 'task-1',
          title: 'Brake Service',
          status: 'DONE',
          done: true,
          lineItemsVersion: 1,
          lineItems: [
            {
              id: 'line-1',
              type: 'PART',
              itemNo: 'PADS',
              description: 'Brake pads',
              qty: 1,
              unitPrice: 80,
            },
          ],
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
    }

    it('toggles checkout open/close state', () => {
      const { result } = renderHook(() =>
        useWorkshopCheckout({ order: baseOrder }),
      )

      expect(result.current.isCheckoutOpen).toBe(false)

      act(() => {
        result.current.handleCheckoutAction()
      })
      expect(result.current.isCheckoutOpen).toBe(true)

      act(() => {
        result.current.closeCheckout()
      })
      expect(result.current.isCheckoutOpen).toBe(false)
    })

    it('navigates to invoice when order is invoiced with linked invoice', () => {
      const invoicedOrder: WorkshopOrder = {
        ...baseOrder,
        status: 'INVOICED',
        invoice: { id: 'inv-123' },
      }

      const { result } = renderHook(() =>
        useWorkshopCheckout({ order: invoicedOrder }),
      )

      act(() => {
        result.current.handleCheckoutAction()
      })

      expect(mockNavigate).toHaveBeenCalledWith('/sales/invoices/inv-123')
    })

    it('handles task discount value changes and sets nested line discounts', () => {
      const { result } = renderHook(() =>
        useWorkshopCheckout({ order: baseOrder }),
      )

      act(() => {
        result.current.handleTaskDiscountValueChange('task-1', '15')
      })

      expect(result.current.taskDiscountOverrides['task-1']).toBe('15')
      expect(result.current.lineDiscountOverrides['task-1:line-1']).toEqual({
        type: 'PERCENTAGE',
        value: '15',
      })
    })

    it('handles line discount type and value changes', () => {
      const { result } = renderHook(() =>
        useWorkshopCheckout({ order: baseOrder }),
      )

      act(() => {
        result.current.handleLineDiscountTypeChange(
          'task-1:line-1',
          'PERCENTAGE',
        )
        result.current.handleLineDiscountValueChange('task-1:line-1', '20')
      })

      expect(result.current.lineDiscountOverrides['task-1:line-1']).toEqual({
        type: 'PERCENTAGE',
        value: '20',
      })

      act(() => {
        result.current.handleLineDiscountTypeChange('task-1:line-1', 'NONE')
      })

      expect(result.current.lineDiscountOverrides['task-1:line-1']).toEqual({
        type: null,
        value: '',
      })
    })

    it('creates draft invoice successfully', async () => {
      mockCreateDraft.mockResolvedValueOnce({
        id: 'inv-new',
        invoice_number: 'INV-001',
      })

      const { result } = renderHook(() =>
        useWorkshopCheckout({ order: baseOrder }),
      )

      await act(async () => {
        await result.current.handleCreateDraftInCheckout()
      })

      expect(mockCreateDraft).toHaveBeenCalledWith('order-1')
      expect(result.current.activeInvoiceId).toBe('inv-new')
      expect(toast.success).toHaveBeenCalledWith(
        'Draft invoice created (INV-001)',
      )
    })

    it('issues invoice and persists line discount overrides', async () => {
      const linkedOrder: WorkshopOrder = {
        ...baseOrder,
        invoice: { id: 'inv-draft-1' },
      }

      vi.mocked(salesApi.useInvoice).mockReturnValue({
        data: {
          id: 'inv-draft-1',
          status: 'DRAFT',
          invoice_number: 'INV-DRAFT',
          items: [
            {
              id: 'line-1',
              source_type: 'WORKSHOP_LINE_ITEM',
              source_id: 'line-1',
              name: 'Pads',
              quantity: 1,
              unit_price: 80,
              subtotal: 80,
              total: 80,
            },
          ],
        },
        isLoading: false,
      } as unknown as ReturnType<typeof salesApi.useInvoice>)

      mockIssueInvoice.mockResolvedValueOnce({
        id: 'inv-draft-1',
        invoice_number: 'INV-FINAL',
      })

      const { result } = renderHook(() =>
        useWorkshopCheckout({ order: linkedOrder }),
      )

      act(() => {
        result.current.handleLineDiscountTypeChange(
          'task-1:line-1',
          'PERCENTAGE',
        )
      })
      act(() => {
        result.current.handleLineDiscountValueChange('task-1:line-1', '10')
      })

      await act(async () => {
        await result.current.handleIssueInvoiceInCheckout()
      })

      expect(mockUpdateDiscount).toHaveBeenCalledWith({
        invoiceId: 'inv-draft-1',
        payload: {
          lineItems: [
            {
              id: 'line-1',
              discountType: 'PERCENTAGE',
              discountValue: 10,
            },
          ],
        },
      })
      expect(mockIssueInvoice).toHaveBeenCalledWith('inv-draft-1')
      expect(toast.success).toHaveBeenCalledWith('Invoice issued (INV-FINAL)')
    })

    it('closes checkout and calls onReopenTask when reopen requested', () => {
      const reopenSpy = vi.fn()
      const { result } = renderHook(() =>
        useWorkshopCheckout({ order: baseOrder, onReopenTask: reopenSpy }),
      )

      act(() => {
        result.current.handleCheckoutAction()
      })
      expect(result.current.isCheckoutOpen).toBe(true)

      act(() => {
        result.current.handleReopenTask('task-1')
      })
      expect(result.current.isCheckoutOpen).toBe(false)
      expect(reopenSpy).toHaveBeenCalledWith('task-1')
    })
  })
})
