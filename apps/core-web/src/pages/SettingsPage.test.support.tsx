import type { ReactNode } from 'react'
import { vi } from 'vitest'

export const financeSettingsResult = {
  data: {
    lock_date: null,
    invoice_prefix: 'RE',
    next_invoice_number: 1,
  },
  isLoading: false,
}

export const updateFinanceSettingsResult = {
  mutateAsync: vi.fn(),
  isPending: false,
}

export const revenueGroupsResult = {
  data: [],
  isLoading: false,
}

export const brandsResult = {
  data: [],
  isLoading: false,
}

export const locationTreeResult = {
  data: [],
  isLoading: false,
  refetch: vi.fn(),
}

export const createLocationResult = {
  mutateAsync: vi.fn(),
  isPending: false,
}

export const deleteLocationResult = {
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

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => ({
    data: {
      activeRole: 'ADMIN',
    },
    isLoading: false,
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

vi.mock('@/components/settings/AuditLogsTab', () => ({
  AuditLogsTab: () => <div>Audit logs tab content</div>,
}))

vi.mock('@/components/settings/LegalEntitiesSettingsTab', () => ({
  LegalEntitiesSettingsTab: () => <div>Legal entities tab content</div>,
}))

vi.mock('@/components/settings/MarginRulesTab', () => ({
  MarginRulesTab: () => <div>Margin rules tab content</div>,
}))

vi.mock('@/components/settings/data-import/DataImportSettingsTab', () => ({
  DataImportSettingsTab: () => <div>Data import tab content</div>,
}))
