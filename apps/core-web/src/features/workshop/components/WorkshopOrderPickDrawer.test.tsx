import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkshopOrderPickDrawer } from './WorkshopOrderPickDrawer'
import { deWorkshop } from '@/test/de-workshop'
import { changeUiLanguage } from '@/lib/i18n'

const qtyLabel = deWorkshop.pick.drawer.qtyAria
  .replace('{{description}}', 'Air filter')
  .replace('{{itemNo}}', 'PART-001')
import * as locationsApi from '@/api/locations'
import * as workshopApi from '@/api/workshop'
import * as authSessionApi from '@/api/auth-session'

vi.mock('@/api/locations')
vi.mock('@/api/workshop')
vi.mock('@/api/auth-session')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createTask(lineQty: number) {
  return {
    id: 'task-1',
    title: 'Inspect',
    lineItems: [
      { id: 'line-1', type: 'PART', catalogItemId: 'catalog-1', itemNo: 'PART-001', description: 'Air filter', qty: lineQty },
    ],
  }
}

function createOrder(tote: string, lineQty = 2, status = 'IN_PROGRESS') {
  return {
    id: 'order-1',
    order_number: 'WO-2026-0001',
    status,
    customer: {
      id: 'customer-1',
      type: 'PRIVATE',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
    tasks: [createTask(lineQty)],
    staging_location_id: tote,
    stagingLocationId: tote,
  }
}

describe('WorkshopOrderPickDrawer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    mocked(authSessionApi.useAuthSession).mockReturnValue({ data: { activeRole: 'SALES' } })
    mocked(locationsApi.useLocations).mockReturnValue({
      data: [
        { id: 'tote-1', code: 'TOTE-01', name: 'Primary Tote', type: 'staging_tote' },
        { id: 'tote-2', code: 'TOTE-02', name: 'Overflow Tote', type: 'staging_tote' },
      ],
      isLoading: false,
    })
    mocked(workshopApi.usePickWorkshopParts).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
  })

  it('keeps edited quantities when the order data refreshes while the drawer stays open', () => {
    let order = createOrder('tote-1')

    mocked(workshopApi.useWorkshopOrder).mockImplementation(() => ({
      data: order,
      isLoading: false,
    }))

    const queryClient = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open={false} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    vi.runAllTimers()

    const quantityInput = screen.getByLabelText(qtyLabel)
    expect(quantityInput).toHaveValue(2)
    expect(screen.getByRole('combobox')).toHaveTextContent('TOTE-01 - Primary Tote')

    fireEvent.change(quantityInput, { target: { value: '1' } })
    expect(quantityInput).toHaveValue(1)

    order = createOrder('tote-2', 5)

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText(qtyLabel)).toHaveValue(1)
    expect(screen.getByRole('combobox')).toHaveTextContent('TOTE-01 - Primary Tote')
  })

  // AUT-989: the drawer header printed the raw status code (INTAKE) instead of the shared WO status label.
  it.each([
    ['de', 'SCHEDULED', 'Geplant'],
    ['de', 'INTAKE', 'Annahme'],
    ['de', 'CONFIRMED', 'Bestätigt'],
    ['de', 'IN_PROGRESS', 'In Bearbeitung'],
    ['de', 'WAITING_PARTS', 'Wartet auf Teile'],
    ['de', 'WAITING_CUSTOMER', 'Wartet auf Kunde'],
    ['de', 'PAUSED', 'Pausiert'],
    ['de', 'COMPLETED', 'Abgeschlossen'],
    ['de', 'INVOICED', 'Fakturiert'],
    ['de', 'CANCELLED', 'Storniert'],
    ['de', 'UNEXPECTED_STATUS', 'Unbekannt'],
    ['en', 'INTAKE', 'Check-in'],
    ['en', 'IN_PROGRESS', 'In Progress'],
  ] as const)('shows the localized %s label for a %s order in the header', async (language, status, label) => {
    await changeUiLanguage(language)
    mocked(workshopApi.useWorkshopOrder).mockReturnValue({ data: createOrder('tote-1', 2, status), isLoading: false })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    const header = within(document.querySelector('[data-pick-drawer-header="true"]') as HTMLElement)
    expect(header.getByText(label, { exact: true })).toBeInTheDocument()
    expect(header.queryByText(status, { exact: true })).toBeNull()
    expect(header.queryByText(`status.${status}`, { exact: true })).toBeNull()
  })
})

