import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as vendorsApi from '@/api/vendors'
import * as brandsApi from '@/api/brands'
import VendorDetail from './VendorDetail'

vi.mock('@/api/vendors', () => ({
  useVendor: vi.fn(),
  useUpdateVendor: vi.fn(),
  useVendorArticles: vi.fn(),
}))

vi.mock('@/api/brands', () => ({
  useBrands: vi.fn(),
}))

vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react')
  type TabsContextValue = {
    value: string
    onValueChange: (v: string) => void
  }
  const TabsContext = React.createContext<TabsContextValue>({
    value: 'orders',
    onValueChange: () => {},
  })

  function Tabs({
    defaultValue = 'orders',
    value,
    onValueChange,
    children,
  }: {
    defaultValue?: string
    value?: string
    onValueChange?: (v: string) => void
    children: React.ReactNode
  }) {
    const [current, setCurrent] = React.useState(value || defaultValue)
    const active = value !== undefined ? value : current
    const setTab = onValueChange || setCurrent
    return (
      <TabsContext.Provider value={{ value: active, onValueChange: setTab }}>
        <div>{children}</div>
      </TabsContext.Provider>
    )
  }

  function TabsList({ children }: { children: React.ReactNode }) {
    return <div role="tablist">{children}</div>
  }

  function TabsTrigger({
    value,
    children,
  }: {
    value: string
    children: React.ReactNode
  }) {
    const ctx = React.useContext(TabsContext)
    return (
      <button
        type="button"
        role="tab"
        aria-selected={ctx.value === value}
        onClick={() => ctx.onValueChange(value)}
      >
        {children}
      </button>
    )
  }

  function TabsContent({
    value,
    children,
  }: {
    value: string
    children: React.ReactNode
  }) {
    const ctx = React.useContext(TabsContext)
    if (ctx.value !== value) return null
    return <div role="tabpanel">{children}</div>
  }

  return { Tabs, TabsList, TabsTrigger, TabsContent }
})

const mockVendor = {
  id: 'vendor-1',
  name: 'Stahlgruber GmbH',
  email: 'info@stahlgruber.de',
  account_number: 'ACC-1234',
  supportedBrands: [],
  purchase_orders: [],
  purchase_invoices: [],
}

const mockArticles = [
  {
    id: 'va-1',
    tenant_id: 'tenant-1',
    vendor_id: 'vendor-1',
    catalog_item_id: 'cat-1',
    vendor_article_no: 'ST-98765',
    last_cost: 45.5,
    last_rrp: 89.9,
    catalog_item: {
      id: 'cat-1',
      sku: '0204114532',
      name: 'Bremsbelagsatz',
    },
  },
]

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={['/vendors/vendor-1']}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/vendors/:id" element={<VendorDetail />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('VendorDetail Price List & Articles integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(vendorsApi.useVendor as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockVendor,
      isLoading: false,
    })
    ;(vendorsApi.useUpdateVendor as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    ;(brandsApi.useBrands as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [],
      isLoading: false,
    })
    ;(vendorsApi.useVendorArticles as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockArticles,
      isLoading: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders "+ Preisliste importieren" action button with preselected vendorId link', () => {
    renderComponent()

    const importBtn = screen.getByRole('link', { name: /\+ Preisliste importieren/i })
    expect(importBtn).toBeInTheDocument()
    expect(importBtn).toHaveAttribute(
      'href',
      '/settings?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=vendor-1',
    )
  })

  it('renders "Lieferanten-Artikelnummern" tab with mapped articles', () => {
    renderComponent()

    const tabTrigger = screen.getByRole('tab', { name: /Lieferanten-Artikelnummern/i })
    expect(tabTrigger).toBeInTheDocument()

    fireEvent.click(tabTrigger)

    expect(screen.getByText('ST-98765')).toBeInTheDocument()
    expect(screen.getByText('Bremsbelagsatz')).toBeInTheDocument()
    expect(screen.getByText('(0204114532)')).toBeInTheDocument()
  })
})
