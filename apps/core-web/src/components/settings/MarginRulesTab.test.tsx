import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from 'sonner'

import type { MarginRule } from '@/api/types'
import * as marginRulesApi from '@/api/margin-rules'
import * as brandsApi from '@/api/brands'
import * as financeApi from '@/api/useFinance'
import { MarginRulesTab } from './MarginRulesTab'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/api/margin-rules', () => ({
  useMarginRules: vi.fn(),
  usePriceJumpThreshold: vi.fn(),
  useCreateMarginRule: vi.fn(),
  useUpdateMarginRule: vi.fn(),
  useDeleteMarginRule: vi.fn(),
  useUpdatePriceJumpThreshold: vi.fn(),
}))

vi.mock('@/api/brands', () => ({
  useBrands: vi.fn(),
}))

vi.mock('@/api/useFinance', () => ({
  useRevenueGroups: vi.fn(),
}))

const mockRules: MarginRule[] = [
  {
    id: 'rule-1',
    tenant_id: 'tenant-1',
    name: 'Bosch Verschleißteile',
    priority: 10,
    brand_id: 1,
    brand: { id: 1, name: 'Bosch' },
    revenue_group_id: 2,
    revenue_group: { id: 2, name: 'Verschleißteile' },
    cost_min: 10,
    cost_max: 100,
    markup_percent: 35,
    use_supplier_rrp: true,
    rounding: 'ROUND_90',
    is_active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

const mockRule2: MarginRule = {
  id: 'rule-2',
  tenant_id: 'tenant-1',
  name: 'Brembo Bremsen',
  priority: 20,
  brand_id: 1,
  brand: { id: 1, name: 'Brembo' },
  revenue_group_id: 2,
  revenue_group: { id: 2, name: 'Verschleißteile' },
  cost_min: 50,
  cost_max: 200,
  markup_percent: 45,
  use_supplier_rrp: false,
  rounding: 'NONE',
  is_active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MarginRulesTab />
    </QueryClientProvider>,
  )
}

describe('MarginRulesTab', () => {
  const createMutation = { mutateAsync: vi.fn(), isPending: false }
  const updateMutation = { mutateAsync: vi.fn(), isPending: false }
  const deleteMutation = { mutateAsync: vi.fn(), isPending: false }
  const thresholdMutation = { mutateAsync: vi.fn(), isPending: false }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(marginRulesApi.useMarginRules as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockRules,
      isLoading: false,
    })
    ;(marginRulesApi.usePriceJumpThreshold as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { price_jump_threshold_percent: 20 },
      isLoading: false,
    })
    ;(marginRulesApi.useCreateMarginRule as ReturnType<typeof vi.fn>).mockReturnValue(
      createMutation,
    )
    ;(marginRulesApi.useUpdateMarginRule as ReturnType<typeof vi.fn>).mockReturnValue(
      updateMutation,
    )
    ;(marginRulesApi.useDeleteMarginRule as ReturnType<typeof vi.fn>).mockReturnValue(
      deleteMutation,
    )
    ;(marginRulesApi.useUpdatePriceJumpThreshold as ReturnType<typeof vi.fn>).mockReturnValue(
      thresholdMutation,
    )
    ;(brandsApi.useBrands as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [{ id: 1, name: 'Bosch' }],
      isLoading: false,
    })
    ;(financeApi.useRevenueGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [{ id: 2, name: 'Verschleißteile' }],
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders rule list table with German headers and rule details', () => {
    renderTab()

    expect(screen.getByText('Margenregeln')).toBeInTheDocument()
    expect(screen.getByText('Bosch Verschleißteile')).toBeInTheDocument()
    expect(screen.getByText('Bosch')).toBeInTheDocument()
    expect(screen.getByText('Verschleißteile')).toBeInTheDocument()
    expect(screen.getByText('35 %')).toBeInTheDocument()
    expect(screen.getByText('Auf .90')).toBeInTheDocument()
  })

  it('renders and updates price jump threshold card', async () => {
    thresholdMutation.mutateAsync.mockResolvedValue({ price_jump_threshold_percent: 25 })
    renderTab()

    const input = screen.getByLabelText(/Schwellenwert/i)
    expect(input).toHaveValue(20)

    fireEvent.change(input, { target: { value: '25' } })
    const saveBtn = screen.getByRole('button', { name: /Schwellenwert speichern/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(thresholdMutation.mutateAsync).toHaveBeenCalledWith({
        threshold_percent: 25,
      })
    })
  })

  it('opens add rule dialog and creates a new rule', async () => {
    createMutation.mutateAsync.mockResolvedValue({})
    renderTab()

    const addBtn = screen.getByRole('button', { name: /\+ Margenregel/i })
    fireEvent.click(addBtn)

    expect(screen.getByText('Neue Margenregel anlegen')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Bezeichnung/i), {
      target: { value: 'Neue Testregel' },
    })
    fireEvent.change(screen.getByLabelText(/^Aufschlag/i), {
      target: { value: '40' },
    })

    const submitBtn = screen.getByRole('button', { name: /Regel erstellen/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(createMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Neue Testregel',
          markup_percent: 40,
        }),
      )
    })
  })

  it('opens edit dialog and saves modified rule', async () => {
    updateMutation.mutateAsync.mockResolvedValue({})
    renderTab()

    const editBtn = screen.getByRole('button', { name: /Bearbeiten/i })
    fireEvent.click(editBtn)

    expect(screen.getByText('Margenregel bearbeiten')).toBeInTheDocument()

    const nameInput = screen.getByLabelText(/^Bezeichnung/i)
    expect(nameInput).toHaveValue('Bosch Verschleißteile')

    fireEvent.change(nameInput, { target: { value: 'Bosch Verschleißteile V2' } })

    const saveBtn = screen.getByRole('button', { name: /Änderungen speichern/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(updateMutation.mutateAsync).toHaveBeenCalledWith({
        id: 'rule-1',
        data: expect.objectContaining({
          name: 'Bosch Verschleißteile V2',
        }),
      })
    })
  })

  it('opens delete confirmation and deletes rule', async () => {
    deleteMutation.mutateAsync.mockResolvedValue({ success: true })
    renderTab()

    const deleteBtn = screen.getByRole('button', { name: /Löschen/i })
    fireEvent.click(deleteBtn)

    expect(screen.getByText(/Margenregel wirklich löschen/i)).toBeInTheDocument()

    const confirmBtn = screen.getByRole('button', { name: /Löschen bestätigen/i })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(deleteMutation.mutateAsync).toHaveBeenCalledWith('rule-1')
    })
  })

  it('toggles priority sorting when clicking Prio header', () => {
    ;(marginRulesApi.useMarginRules as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [mockRules[0], mockRule2],
      isLoading: false,
    })

    renderTab()

    const rowsBefore = screen.getAllByRole('row').slice(1)
    expect(rowsBefore[0]).toHaveTextContent('Bosch Verschleißteile')
    expect(rowsBefore[1]).toHaveTextContent('Brembo Bremsen')

    const prioBtn = screen.getByRole('button', { name: /Priorität sortieren/i })
    fireEvent.click(prioBtn)

    const rowsAfterDesc = screen.getAllByRole('row').slice(1)
    expect(rowsAfterDesc[0]).toHaveTextContent('Brembo Bremsen')
    expect(rowsAfterDesc[1]).toHaveTextContent('Bosch Verschleißteile')

    fireEvent.click(prioBtn)

    const rowsAfterAsc = screen.getAllByRole('row').slice(1)
    expect(rowsAfterAsc[0]).toHaveTextContent('Bosch Verschleißteile')
    expect(rowsAfterAsc[1]).toHaveTextContent('Brembo Bremsen')
  })

  it('shows error when cost_min > cost_max on submit', async () => {
    renderTab()

    const addBtn = screen.getByRole('button', { name: /\+ Margenregel/i })
    fireEvent.click(addBtn)

    fireEvent.change(screen.getByLabelText(/^Bezeichnung/i), {
      target: { value: 'Ungültige Regel' },
    })
    fireEvent.change(screen.getByLabelText(/Min\. Einkaufspreis/i), {
      target: { value: '100' },
    })
    fireEvent.change(screen.getByLabelText(/Max\. Einkaufspreis/i), {
      target: { value: '50' },
    })

    const submitBtn = screen.getByRole('button', { name: /Regel erstellen/i })
    fireEvent.click(submitBtn)

    expect(toast.error).toHaveBeenCalledWith(
      'Mindest-Einkaufspreis darf nicht größer als Höchst-Einkaufspreis sein',
    )
    expect(createMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('shows error when markup_percent < 0 on submit', async () => {
    renderTab()

    const addBtn = screen.getByRole('button', { name: /\+ Margenregel/i })
    fireEvent.click(addBtn)

    fireEvent.change(screen.getByLabelText(/^Bezeichnung/i), {
      target: { value: 'Negativer Aufschlag' },
    })
    fireEvent.change(screen.getByLabelText(/^Aufschlag/i), {
      target: { value: '-10' },
    })

    const submitBtn = screen.getByRole('button', { name: /Regel erstellen/i })
    fireEvent.click(submitBtn)

    expect(toast.error).toHaveBeenCalledWith('Aufschlag darf nicht negativ sein')
    expect(createMutation.mutateAsync).not.toHaveBeenCalled()
  })
})
