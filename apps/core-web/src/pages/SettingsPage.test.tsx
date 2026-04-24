import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import SettingsPage from './SettingsPage'

const financeSettingsResult = {
  data: {
    lock_date: null,
    invoice_prefix: 'RE',
    next_invoice_number: 1,
  },
  isLoading: false,
}

const updateFinanceSettingsResult = {
  mutateAsync: vi.fn(),
  isPending: false,
}

const revenueGroupsResult = {
  data: [],
  isLoading: false,
}

const brandsResult = {
  data: [],
  isLoading: false,
}

const locationTreeResult = {
  data: [],
  isLoading: false,
  refetch: vi.fn(),
}

const createLocationResult = {
  mutateAsync: vi.fn(),
  isPending: false,
}

const deleteLocationResult = {
  mutateAsync: vi.fn(),
  isPending: false,
}

vi.mock('@/components/ui/tabs', async () => {
  const React = await import('react')

  type TabsContextValue = {
    value: string
    onValueChange?: (value: string) => void
  }

  type TabsProps = {
    value: string
    onValueChange?: (value: string) => void
    className?: string
    children: ReactNode
  }

  type TabsListProps = {
    className?: string
    children: ReactNode
  }

  type TabsTriggerProps = {
    value: string
    className?: string
    children: ReactNode
  }

  type TabsContentProps = {
    value: string
    className?: string
    children: ReactNode
  }

  const TabsContext = React.createContext<TabsContextValue | null>(null)

  function Tabs({ value, onValueChange, className, children }: TabsProps) {
    return (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div className={className}>{children}</div>
      </TabsContext.Provider>
    )
  }

  function TabsList({ className, children }: TabsListProps) {
    return (
      <div role='tablist' className={className}>
        {children}
      </div>
    )
  }

  function TabsTrigger({ value, className, children }: TabsTriggerProps) {
    const context = React.useContext(TabsContext)
    const isActive = context?.value === value

    return (
      <button
        type='button'
        role='tab'
        aria-selected={isActive}
        data-state={isActive ? 'active' : 'inactive'}
        className={className}
        onClick={() => context?.onValueChange?.(value)}
      >
        {children}
      </button>
    )
  }

  function TabsContent({ value, className, children }: TabsContentProps) {
    const context = React.useContext(TabsContext)

    if (context?.value !== value) {
      return null
    }

    return (
      <div role='tabpanel' className={className}>
        {children}
      </div>
    )
  }

  return {
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
  }
})

vi.mock('@/api/useFinance', () => ({
  useFinanceSettings: () => financeSettingsResult,
  useUpdateFinanceSettings: () => updateFinanceSettingsResult,
  useRevenueGroups: () => revenueGroupsResult,
}))

vi.mock('@/api/brands', () => ({
  useBrands: () => brandsResult,
}))

vi.mock('@/api/locations', () => ({
  useLocationTree: () => locationTreeResult,
  useCreateLocation: () => createLocationResult,
  useDeleteLocation: () => deleteLocationResult,
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    claims: {
      role: 'ADMIN',
    },
  }),
}))

vi.mock('@/components/RevenueGroupTable', () => ({
  RevenueGroupTable: () => <div>Revenue groups table</div>,
}))

vi.mock('@/components/AddRevenueGroupDialog', () => ({
  AddRevenueGroupDialog: () => <button type='button'>+ Group</button>,
}))

vi.mock('@/components/BrandTable', () => ({
  BrandTable: () => <div>Brands table</div>,
}))

vi.mock('@/components/AddBrandDialog', () => ({
  AddBrandDialog: () => <button type='button'>+ Brand</button>,
}))

vi.mock('@/components/labor/LaborCategoriesTab', () => ({
  LaborCategoriesTab: () => <div>Labor tab content</div>,
}))

vi.mock('@/components/settings/EmployeeSettingsTab', () => ({
  EmployeeSettingsTab: () => <div>Employees tab content</div>,
}))

vi.mock('@/components/settings/BaySettingsTab', () => ({
  BaySettingsTab: () => <div>Bays tab content</div>,
}))

vi.mock('@/components/settings/TeamSettingsTab', () => ({
  TeamSettingsTab: () => <div>Team tab content</div>,
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid='location-search'>{location.search}</div>
}

describe('SettingsPage tab integration', () => {
  it('renders Employees and Bays triggers and respects the initial employees query param', async () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=employees']}>
        <Routes>
          <Route
            path='/settings'
            element={
              <>
                <SettingsPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('tab', { name: 'Employees' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Bays' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Team' })).toBeVisible()
    expect(screen.getByText('Employees tab content')).toBeVisible()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=employees')

    fireEvent.click(screen.getByRole('tab', { name: 'Bays' }))

    await waitFor(() => {
      expect(screen.getByText('Bays tab content')).toBeVisible()
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=bays')
    })
  })
})
