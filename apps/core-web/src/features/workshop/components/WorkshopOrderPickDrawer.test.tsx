import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkshopOrderPickDrawer } from './WorkshopOrderPickDrawer'
import { initI18n } from '@/lib/i18n/init-i18n'
import { deWorkshop } from '@/test/de-workshop'

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

  afterEach(async () => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
    await initI18n({ language: 'de' })
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

  it('shows localized DE status label Annahme instead of raw INTAKE in the drawer header', () => {
    mocked(workshopApi.useWorkshopOrder).mockReturnValue({
      data: createOrder('tote-1', 2, 'INTAKE'),
      isLoading: false,
    })

    const { baseElement } = render(
      <QueryClientProvider client={createQueryClient()}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    const header = baseElement.querySelector('[data-pick-drawer-header="true"]') as HTMLElement
    expect(within(header).getByText('Annahme')).toBeInTheDocument()
    expect(within(header).queryByText('INTAKE')).not.toBeInTheDocument()
  })

  it('shows localized DE status label In Bearbeitung instead of raw IN_PROGRESS in the drawer header', () => {
    mocked(workshopApi.useWorkshopOrder).mockReturnValue({
      data: createOrder('tote-1', 2, 'IN_PROGRESS'),
      isLoading: false,
    })

    const { baseElement } = render(
      <QueryClientProvider client={createQueryClient()}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    const header = baseElement.querySelector('[data-pick-drawer-header="true"]') as HTMLElement
    expect(within(header).getByText('In Bearbeitung')).toBeInTheDocument()
    expect(within(header).queryByText('IN_PROGRESS')).not.toBeInTheDocument()
  })

  it('shows localized EN status labels instead of raw codes in the drawer header', async () => {
    await initI18n({ language: 'en' })
    const queryClient = createQueryClient()

    mocked(workshopApi.useWorkshopOrder).mockReturnValue({
      data: createOrder('tote-1', 2, 'INTAKE'),
      isLoading: false,
    })

    const { baseElement, rerender } = render(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    let header = baseElement.querySelector('[data-pick-drawer-header="true"]') as HTMLElement
    expect(within(header).getByText('Check-in')).toBeInTheDocument()
    expect(within(header).queryByText('INTAKE')).not.toBeInTheDocument()

    mocked(workshopApi.useWorkshopOrder).mockReturnValue({
      data: createOrder('tote-1', 2, 'IN_PROGRESS'),
      isLoading: false,
    })

    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    header = baseElement.querySelector('[data-pick-drawer-header="true"]') as HTMLElement
    expect(within(header).getByText('In Progress')).toBeInTheDocument()
    expect(within(header).queryByText('IN_PROGRESS')).not.toBeInTheDocument()
  })

  it.each([
    ['SCHEDULED', 'Geplant'],
    ['INTAKE', 'Annahme'],
    ['CONFIRMED', 'Bestätigt'],
    ['IN_PROGRESS', 'In Bearbeitung'],
    ['WAITING_PARTS', 'Wartet auf Teile'],
    ['WAITING_CUSTOMER', 'Wartet auf Kunde'],
    ['PAUSED', 'Pausiert'],
    ['COMPLETED', 'Abgeschlossen'],
    ['INVOICED', 'Fakturiert'],
    ['CANCELLED', 'Storniert'],
    ['UNEXPECTED_STATUS', 'Unbekannt'],
  ])('renders %s as %s without falling back to the raw code or i18n key', (status, expectedLabel) => {
    mocked(workshopApi.useWorkshopOrder).mockReturnValue({
      data: createOrder('tote-1', 2, status),
      isLoading: false,
    })

    const { baseElement } = render(
      <QueryClientProvider client={createQueryClient()}>
        <WorkshopOrderPickDrawer orderId='order-1' open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    )

    const header = baseElement.querySelector('[data-pick-drawer-header="true"]') as HTMLElement
    expect(within(header).getByText(expectedLabel)).toBeInTheDocument()
    expect(within(header).queryByText(status)).not.toBeInTheDocument()
    expect(within(header).queryByText(`status.${status}`)).not.toBeInTheDocument()
  })
})

