import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

export const financeSettingsResult = {
  data: {
    lock_date: null as string | null,
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
    value?: string
    defaultValue?: string
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

  function Tabs({ value, defaultValue, onValueChange, className, children }: TabsProps) {
    const [internalValue, setInternalValue] = React.useState(defaultValue ?? '')
    const isControlled = value !== undefined
    const currentValue = isControlled ? value : internalValue
    const handleValueChange = (next: string) => {
      if (!isControlled) setInternalValue(next)
      onValueChange?.(next)
    }

    return (
      <TabsContext.Provider value={{ value: currentValue, onValueChange: handleValueChange }}>
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

export const authSessionResult: { data?: { activeRole: string }; isLoading: boolean } = {
  data: { activeRole: 'ADMIN' },
  isLoading: false,
}

vi.mock('@/api/auth-session', () => ({
  useAuthSession: () => authSessionResult,
}))

vi.mock('@/components/RevenueGroupTable', () => ({
  RevenueGroupTable: ({ groups }: { groups: unknown[] }) => <div>Revenue groups table ({groups.length})</div>,
}))

vi.mock('@/components/AddRevenueGroupDialog', () => ({
  AddRevenueGroupDialog: () => <button type='button'>+ Group</button>,
}))

vi.mock('@/components/BrandTable', () => ({
  BrandTable: ({ brands, onEdit }: { brands: { name: string }[]; onEdit: (brand: { name: string }) => void }) => (
    <div>
      Brands table ({brands.length})
      {brands.map((brand) => (
        <button key={brand.name} type='button' onClick={() => onEdit(brand)}>
          Edit {brand.name}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/AddBrandDialog', () => ({
  AddBrandDialog: ({ brand, onClose }: { brand: { name: string } | null; onClose: () => void }) => (
    <div>
      <span>Editing brand: {brand ? brand.name : 'none'}</span>
      <button type='button' onClick={onClose}>
        Close brand dialog
      </button>
    </div>
  ),
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

vi.mock('@/components/settings/ApiKeysSettingsTab', () => ({
  ApiKeysSettingsTab: () => <div>API keys tab content</div>,
}))

vi.mock('@/components/settings/VoiceTranslationSettingsTab', () => ({
  VoiceTranslationSettingsTab: () => <div>Voice translation tab content</div>,
}))

vi.mock('@/components/settings/workshop-hours-settings-panel', () => ({
  WorkshopHoursSettingsPanel: () => <div>Hours tab content</div>,
}))

vi.mock('@/components/settings/vehicle-data-settings-panel', () => ({
  VehicleDataSettingsPanel: () => <div>Vehicle data tab content</div>,
}))

vi.mock('@/components/settings/sites-settings-tab', () => ({
  SitesSettingsTab: () => <div>Sites tab content</div>,
}))

vi.mock('@/components/settings/accounting-export-settings-panel', () => ({
  AccountingExportSettingsPanel: () => <div>Accounting export tab content</div>,
}))

describe('SettingsPage shared test support', () => {
  it('registers shared mocks', () => {
    expect(true).toBe(true)
  })
})
