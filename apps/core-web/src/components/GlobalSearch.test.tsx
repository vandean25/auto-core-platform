import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { GlobalSearch } from './GlobalSearch'

const SEARCH_PLACEHOLDER_DE = 'Teile, Kunden, Fahrzeuge, Aufträge…'
const SEARCH_DESCRIPTION_DE =
  'Teil, Kunde, Fahrzeug, Auftrag oder Befehl aufrufen.'
import * as searchHook from '@/hooks/useGlobalSearch'
import type { WorkshopOrder } from '@/api/types'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/hooks/useGlobalSearch')

describe('GlobalSearch Component', () => {
  beforeEach(async () => {
    await changeUiLanguage('de')
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders updated placeholder and dialog description', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: { inventory: [], customers: [], vehicles: [], orders: [] },
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)).toBeInTheDocument()
    expect(screen.getByText(SEARCH_DESCRIPTION_DE)).toBeInTheDocument()
  })

  it('renders Customers, Vehicles, Workshop orders, and Inventory groups when query matches', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: {
        customers: [
          {
            id: 'cust-123',
            type: 'PRIVATE',
            first_name: 'Max',
            last_name: 'Mustermann',
            email: 'max@mustermann.at',
            phone: '+43 1 234567',
            vehicles: [],
          },
        ],
        vehicles: [
          {
            id: 'veh-456',
            make: 'Volkswagen',
            model: 'Golf',
            year: 2021,
            plate: 'W-12345AB',
            vin: 'WVWZZZ12345',
            customer: null,
          },
        ],
        orders: [
          {
            id: 'wo-789',
            order_number: 'WO-2026-0004',
            status: 'IN_PROGRESS',
            customer: { id: 'cust-123', type: 'PRIVATE', first_name: 'Max', last_name: 'Mustermann' },
            vehicle: { id: 'veh-456', make: 'Audi', model: 'A4', year: 2020, plate: 'W-12345AB' },
          } as unknown as WorkshopOrder,
        ],
        inventory: [
          {
            id: 'item-1',
            sku: 'BRK-001',
            name: 'Brake Pad',
            brand: 'Bosch',
            price: 49.9,
            quantity_available: 4,
            warehouse_location: 'A-01',
            status: 'IN_STOCK',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'Mustermann' } })

    expect(screen.getByText('Kunden')).toBeInTheDocument()
    expect(screen.getByText('Max Mustermann')).toBeInTheDocument()

    expect(screen.getByText('Fahrzeuge')).toBeInTheDocument()
    expect(screen.getByText('W-12345AB')).toBeInTheDocument()

    expect(screen.getByText('Werkstattaufträge')).toBeInTheDocument()
    expect(screen.getByText('WO-2026-0004')).toBeInTheDocument()

    expect(screen.getByText('Lager')).toBeInTheDocument()
    expect(screen.getByText('BRK-001')).toBeInTheDocument()
  })

  it('navigates to customer detail when customer item selected', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: {
        customers: [
          {
            id: 'cust-123',
            type: 'PRIVATE',
            first_name: 'Max',
            last_name: 'Mustermann',
            email: 'max@mustermann.at',
            phone: '+43 1 234567',
            vehicles: [],
          },
        ],
        vehicles: [],
        orders: [],
        inventory: [],
      },
      isLoading: false,
      isFetching: false,
      error: null,
    })

    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'Mustermann' } })

    const customerItem = screen.getByText('Max Mustermann')
    fireEvent.click(customerItem)

    expect(mockNavigate).toHaveBeenCalledWith('/customers/cust-123')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders updated empty state copy when no results match', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: { inventory: [], customers: [], vehicles: [], orders: [] },
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'xyz123nonexistent' } })

    expect(
      screen.getByText(/Keine Teile, Kunden, Fahrzeuge, Aufträge oder Befehle passen zu „xyz123nonexistent“\./),
    ).toBeInTheDocument()
  })

  it('navigates to /vehicles/:id when selecting a vehicle match', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: {
        inventory: [],
        customers: [],
        vehicles: [
          {
            id: 'veh-456',
            make: 'Audi',
            model: 'A4',
            year: 2020,
            plate: 'W-12345AB',
            vin: 'WAUZZZ8K9BA123456',
            customer: null,
          },
        ],
        orders: [],
      },
      isLoading: false,
      isFetching: false,
      error: null,
    })

    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'W-12345AB' } })

    const vehicleItem = screen.getByText('W-12345AB')
    fireEvent.click(vehicleItem)

    expect(mockNavigate).toHaveBeenCalledWith('/vehicles/veh-456')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('navigates to /workshop/orders/:id when selecting an order match', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: {
        inventory: [],
        customers: [],
        vehicles: [],
        orders: [
          {
            id: 'wo-789',
            order_number: 'WO-2026-0004',
            status: 'IN_PROGRESS',
            customer: { id: 'cust-123', type: 'PRIVATE', first_name: 'Max', last_name: 'Mustermann' },
            vehicle: { id: 'veh-456', make: 'Audi', model: 'A4', year: 2020, plate: 'W-12345AB' },
          } as unknown as WorkshopOrder,
        ],
      },
      isLoading: false,
      isFetching: false,
      error: null,
    })

    const onOpenChange = vi.fn()
    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={onOpenChange} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'WO-2026-0004' } })

    const orderItem = screen.getByText('WO-2026-0004')
    fireEvent.click(orderItem)

    expect(mockNavigate).toHaveBeenCalledWith('/workshop/orders/wo-789')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('filters quick actions so searching "invoice" shows Find a sales order to invoice', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: { inventory: [], customers: [], vehicles: [], orders: [] },
      isLoading: false,
      isFetching: false,
      error: null,
    })

    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'rechnung' } })

    expect(screen.getByText('Kundenauftrag zum Fakturieren finden')).toBeInTheDocument()
    expect(screen.queryByText('Create Purchase Order')).not.toBeInTheDocument()
  })

  it('does not display CommandEmpty while search is still fetching', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: { inventory: [], customers: [], vehicles: [], orders: [] },
      isLoading: true,
      isFetching: true,
      error: null,
    })

    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'Mustermann' } })

    expect(screen.getByText('Suche…')).toBeInTheDocument()
    expect(screen.queryByText(/No parts, customers, vehicles, jobs, or commands match/)).not.toBeInTheDocument()
  })

  it('does not display CommandEmpty when an error is present', () => {
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue({
      data: { inventory: [], customers: [], vehicles: [], orders: [] },
      isLoading: false,
      isFetching: false,
      error: new Error('Network error'),
    })

    render(
      <MemoryRouter>
        <GlobalSearch open={true} onOpenChange={vi.fn()} />
      </MemoryRouter>,
    )

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER_DE)
    fireEvent.change(input, { target: { value: 'test' } })

    expect(screen.getByText('Suche vorübergehend nicht verfügbar.')).toBeInTheDocument()
    expect(screen.queryByText(/No parts, customers, vehicles, jobs, or commands match/)).not.toBeInTheDocument()
  })
})
