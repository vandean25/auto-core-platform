import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalSearch } from './GlobalSearch'
import * as searchHook from '@/hooks/useGlobalSearch'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/hooks/useGlobalSearch')

const emptySearchResults = {
  data: { inventory: [], customers: [], vehicles: [], orders: [] },
  isLoading: false,
  isFetching: false,
  error: null,
}

const SEARCH_PLACEHOLDER = 'Teile, Kunden, Fahrzeuge, Aufträge…'

function renderPalette(onOpenChange = vi.fn()) {
  render(
    <MemoryRouter>
      <GlobalSearch open={true} onOpenChange={onOpenChange} />
    </MemoryRouter>,
  )
  return { onOpenChange, input: screen.getByPlaceholderText(SEARCH_PLACEHOLDER) }
}

describe('GlobalSearch no-result hint and quick action routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(searchHook.useGlobalSearch).mockReturnValue(emptySearchResults)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a full-name hint when nothing matches the query', () => {
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'zzz unknown' } })

    expect(
      screen.getByText(/No parts, customers, vehicles, jobs, or commands match “zzz unknown”/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Try a full name \(first and last\)/)).toBeInTheDocument()
  })

  it('does not show the no-result hint before the user types', () => {
    renderPalette()

    expect(screen.queryByText(/Try a full name/)).not.toBeInTheDocument()
  })

  it('opens the sales order list from "Find a sales order to invoice" and closes the palette', () => {
    const { input, onOpenChange } = renderPalette()

    fireEvent.change(input, { target: { value: 'invoice' } })
    fireEvent.click(screen.getByText('Find a sales order to invoice'))

    expect(mockNavigate).toHaveBeenCalledWith('/sales-orders')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('no longer offers the old Create Sales Invoice label', () => {
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'invoice' } })

    expect(screen.queryByText('Create Sales Invoice')).not.toBeInTheDocument()
  })

  it('routes Create Sales Order to the new sales order form', () => {
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'sales order' } })
    fireEvent.click(screen.getByText('Create Sales Order'))

    expect(mockNavigate).toHaveBeenCalledWith('/sales-orders/new')
  })
})
