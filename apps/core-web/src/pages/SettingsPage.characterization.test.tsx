import {
  authSessionResult,
  brandsResult,
  financeSettingsResult,
  revenueGroupsResult,
  updateFinanceSettingsResult,
} from './SettingsPage.test.support.test'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../locales/de/common.json'
import deSettings from '../../../../locales/de/settings.json'
import SettingsPage from './SettingsPage'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const defaultFinanceData = { lock_date: null as string | null, invoice_prefix: 'RE', next_invoice_number: 1 }

function LocationProbe() {
  const location = useLocation()
  return <div data-testid='location-search'>{location.search}</div>
}

function renderSettings(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
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
}

const tabNames = deSettings.tabs
const privilegedTabs = [
  [tabNames.legalEntities, 'legal-entities', 'Legal entities tab content'],
  [tabNames.sites, 'sites', 'Sites tab content'],
  [tabNames.vehicleData, 'vehicle-data', 'Vehicle data tab content'],
  [tabNames.marginRules, 'margin-rules', 'Margin rules tab content'],
  [tabNames.dataImport, 'data-import', 'Data import tab content'],
  [tabNames.team, 'team', 'Team tab content'],
  [tabNames.apiKeys, 'api-keys', 'API keys tab content'],
] as const

const openTabs = [
  [tabNames.voiceTranslation, 'voice-translation', 'Voice translation tab content'],
  [tabNames.revenueGroups, 'revenue-groups', 'Revenue groups table (0)'],
  [tabNames.brands, 'brands', 'Brands table (0)'],
  [tabNames.employees, 'employees', 'Employees tab content'],
  [tabNames.bays, 'bays', 'Bays tab content'],
  [tabNames.hours, 'hours', 'Hours tab content'],
  [tabNames.labor, 'labor', 'Labor tab content'],
  [tabNames.auditLogs, 'audit-logs', 'Audit logs tab content'],
] as const

function setRole(activeRole: string) {
  authSessionResult.data = { activeRole }
}

function lockDateInput() {
  return screen.getByLabelText(deSettings.finance.fiscal.lockDate)
}

function submitFinanceForm() {
  fireEvent.click(screen.getByRole('button', { name: deSettings.finance.saveChanges }))
}

beforeEach(() => {
  vi.clearAllMocks()
  setRole('ADMIN')
  authSessionResult.isLoading = false
  Object.assign(financeSettingsResult, { data: { ...defaultFinanceData }, isLoading: false })
  Object.assign(updateFinanceSettingsResult, { isPending: false })
  updateFinanceSettingsResult.mutateAsync.mockResolvedValue(undefined)
  Object.assign(revenueGroupsResult, { data: [], isLoading: false })
  Object.assign(brandsResult, { data: [], isLoading: false })
})

afterEach(() => {
  cleanup()
})

describe('SettingsPage characterization: session and header', () => {
  it('shows only the page loader while the auth session is loading', () => {
    authSessionResult.isLoading = true
    renderSettings()

    expect(screen.getByText(deCommon.pageLoader.loading)).toBeVisible()
    expect(screen.queryByRole('heading', { name: deSettings.page.title })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('renders the page title and description once the session is loaded', () => {
    renderSettings()

    expect(screen.getByRole('heading', { level: 1, name: deSettings.page.title })).toBeVisible()
    expect(screen.getByText(deSettings.page.description)).toBeVisible()
  })
})

describe('SettingsPage characterization: tab visibility by role', () => {
  it.each(['ADMIN', 'OWNER'])('shows every tab to %s in the documented order', (role) => {
    setRole(role)
    renderSettings()

    const [mainTabList] = screen.getAllByRole('tablist')
    const labels = within(mainTabList).getAllByRole('tab').map((tab) => tab.textContent)
    expect(labels).toEqual([
      tabNames.finance,
      tabNames.voiceTranslation,
      tabNames.revenueGroups,
      tabNames.brands,
      tabNames.legalEntities,
      tabNames.sites,
      tabNames.locations,
      tabNames.employees,
      tabNames.bays,
      tabNames.hours,
      tabNames.labor,
      tabNames.vehicleData,
      tabNames.marginRules,
      tabNames.dataImport,
      tabNames.team,
      tabNames.apiKeys,
      tabNames.auditLogs,
    ])
  })

  it.each(['SALES', 'TECH'])('hides the admin-only tabs from %s', (role) => {
    setRole(role)
    renderSettings()

    const [mainTabList] = screen.getAllByRole('tablist')
    const labels = within(mainTabList).getAllByRole('tab').map((tab) => tab.textContent)
    expect(labels).toEqual([
      tabNames.finance,
      tabNames.voiceTranslation,
      tabNames.revenueGroups,
      tabNames.brands,
      tabNames.locations,
      tabNames.employees,
      tabNames.bays,
      tabNames.hours,
      tabNames.labor,
      tabNames.auditLogs,
    ])
  })

  it('treats a missing session like a non-admin', () => {
    authSessionResult.data = undefined
    renderSettings()

    expect(screen.queryByRole('tab', { name: tabNames.team })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: deSettings.finance.subTabs.accountingExport })).not.toBeInTheDocument()
  })
})

describe('SettingsPage characterization: active tab resolution', () => {
  it('defaults to the finance tab when no tab query param is given', () => {
    renderSettings()

    expect(screen.getByRole('tab', { name: tabNames.finance })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toBeVisible()
  })

  it('falls back to the finance tab for an unknown tab query param without rewriting the URL', () => {
    renderSettings('?tab=does-not-exist')

    expect(screen.getByRole('tab', { name: tabNames.finance })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=does-not-exist')
  })

  it.each(openTabs)('opens %s from ?tab=%s for an admin', (label, value, content) => {
    renderSettings(`?tab=${value}`)

    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(content)).toBeVisible()
  })

  it.each(privilegedTabs)('opens %s from ?tab=%s for an admin', (label, value, content) => {
    renderSettings(`?tab=${value}`)

    expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(content)).toBeVisible()
  })

  it.each(privilegedTabs)('falls back to finance for ?tab=%s when the role is not admin or owner', (_label, value, content) => {
    setRole('SALES')
    renderSettings(`?tab=${value}`)

    expect(screen.getByRole('tab', { name: tabNames.finance })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(content)).not.toBeInTheDocument()
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toBeVisible()
    expect(screen.getByTestId('location-search')).toHaveTextContent(`?tab=${value}`)
  })

  it('opens the storage locations tab', () => {
    renderSettings('?tab=locations')

    expect(screen.getByRole('tab', { name: tabNames.locations })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 2, name: deSettings.storageLocations.title })).toBeVisible()
  })

  it('replaces the whole query string with the clicked tab', async () => {
    renderSettings('?tab=brands&extra=1')

    fireEvent.click(screen.getByRole('tab', { name: tabNames.labor }))

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent(/^\?tab=labor$/)
    })
    expect(screen.getByText('Labor tab content')).toBeVisible()
  })
})

describe('SettingsPage characterization: revenue groups and brands tabs', () => {
  it('shows the revenue groups heading, the add dialog trigger and the table with the loaded groups', () => {
    revenueGroupsResult.data = [{ id: 'g1' }, { id: 'g2' }] as never
    renderSettings('?tab=revenue-groups')

    expect(screen.getByRole('heading', { level: 2, name: deSettings.revenueGroups.title })).toBeVisible()
    expect(screen.getByText(deSettings.revenueGroups.description)).toBeVisible()
    expect(screen.getByRole('button', { name: '+ Group' })).toBeVisible()
    expect(screen.getByText('Revenue groups table (2)')).toBeVisible()
  })

  it('shows a spinner instead of the revenue groups table while loading', () => {
    revenueGroupsResult.isLoading = true
    revenueGroupsResult.data = undefined as never
    const { container } = renderSettings('?tab=revenue-groups')

    expect(screen.queryByText(/Revenue groups table/)).not.toBeInTheDocument()
    expect(container.querySelector('svg.animate-spin')).toBeInTheDocument()
  })

  it('passes an empty list to the revenue groups table when no data is available', () => {
    revenueGroupsResult.data = undefined as never
    renderSettings('?tab=revenue-groups')

    expect(screen.getByText('Revenue groups table (0)')).toBeVisible()
  })

  it('shows the brands heading and the table with the loaded brands', () => {
    brandsResult.data = [{ name: 'Audi' }] as never
    renderSettings('?tab=brands')

    expect(screen.getByRole('heading', { level: 2, name: deSettings.brands.title })).toBeVisible()
    expect(screen.getByText(deSettings.brands.description)).toBeVisible()
    expect(screen.getByText('Brands table (1)')).toBeVisible()
  })

  it('shows a spinner instead of the brands table while loading and an empty list without data', () => {
    brandsResult.isLoading = true
    brandsResult.data = undefined as never
    const { container, unmount } = renderSettings('?tab=brands')

    expect(screen.queryByText(/Brands table/)).not.toBeInTheDocument()
    expect(container.querySelector('svg.animate-spin')).toBeInTheDocument()
    unmount()

    brandsResult.isLoading = false
    renderSettings('?tab=brands')
    expect(screen.getByText('Brands table (0)')).toBeVisible()
  })

  it('hands the brand picked for editing to the dialog and clears it on close', () => {
    brandsResult.data = [{ name: 'Audi' }] as never
    renderSettings('?tab=brands')

    expect(screen.getByText('Editing brand: none')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Audi' }))
    expect(screen.getByText('Editing brand: Audi')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Close brand dialog' }))
    expect(screen.getByText('Editing brand: none')).toBeVisible()
  })
})

describe('SettingsPage characterization: finance tab', () => {
  it('shows a spinner instead of the form while the finance settings load', () => {
    financeSettingsResult.isLoading = true
    financeSettingsResult.data = undefined as never
    const { container } = renderSettings()

    expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
    expect(container.querySelector('svg.animate-spin')).toBeInTheDocument()
  })

  it('fills the form from the loaded settings and formats the lock date as yyyy-MM-dd', () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'INV', next_invoice_number: 42 }
    renderSettings()

    expect(lockDateInput()).toHaveValue('2026-03-31')
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toHaveValue('INV')
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toHaveValue(42)
  })

  it('shows an empty lock date when none is set', () => {
    renderSettings()

    expect(lockDateInput()).toHaveValue('')
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toHaveValue('RE')
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toHaveValue(1)
  })

  it('starts with an empty form while no settings are loaded', () => {
    financeSettingsResult.data = undefined as never
    renderSettings()

    expect(lockDateInput()).toHaveValue('')
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toHaveValue('')
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toHaveValue(0)
  })

  it('saves edited values directly when there is no existing lock date and shows a success toast', async () => {
    renderSettings()

    fireEvent.change(lockDateInput(), { target: { value: '2026-05-01' } })
    fireEvent.change(screen.getByLabelText(deSettings.finance.invoicing.prefix), { target: { value: 'AR' } })
    fireEvent.change(screen.getByLabelText(deSettings.finance.invoicing.nextNumber), { target: { value: '77' } })
    submitFinanceForm()

    await waitFor(() => {
      expect(updateFinanceSettingsResult.mutateAsync).toHaveBeenCalledWith({
        lock_date: '2026-05-01',
        invoice_prefix: 'AR',
        next_invoice_number: 77,
      })
    })
    expect(toast.success).toHaveBeenCalledWith(deSettings.finance.toast.updated)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('sends a null lock date when the field is empty and coerces an unparsable invoice number to 0', async () => {
    renderSettings()

    fireEvent.change(screen.getByLabelText(deSettings.finance.invoicing.nextNumber), { target: { value: '' } })
    submitFinanceForm()

    await waitFor(() => {
      expect(updateFinanceSettingsResult.mutateAsync).toHaveBeenCalledWith({
        lock_date: null,
        invoice_prefix: 'RE',
        next_invoice_number: 0,
      })
    })
  })

  it('shows an error toast when saving fails', async () => {
    updateFinanceSettingsResult.mutateAsync.mockRejectedValueOnce(new Error('boom'))
    renderSettings()

    submitFinanceForm()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(deSettings.finance.toast.updateFailed)
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('disables the submit button while the update is pending', () => {
    updateFinanceSettingsResult.isPending = true
    renderSettings()

    expect(screen.getByRole('button', { name: deSettings.finance.saveChanges })).toBeDisabled()
  })

  it('saves directly when the new lock date is not later than the existing one', async () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'RE', next_invoice_number: 1 }
    renderSettings()

    fireEvent.change(lockDateInput(), { target: { value: '2026-02-01' } })
    submitFinanceForm()

    await waitFor(() => {
      expect(updateFinanceSettingsResult.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ lock_date: '2026-02-01' }),
      )
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('saves directly when the lock date is cleared even though one exists', async () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'RE', next_invoice_number: 1 }
    renderSettings()

    fireEvent.change(lockDateInput(), { target: { value: '' } })
    submitFinanceForm()

    await waitFor(() => {
      expect(updateFinanceSettingsResult.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ lock_date: null }),
      )
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks for confirmation before moving the lock date later and saves only after confirming', async () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'RE', next_invoice_number: 1 }
    renderSettings()

    fireEvent.change(lockDateInput(), { target: { value: '2026-06-30' } })
    submitFinanceForm()

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(deSettings.finance.lockDialog.title)).toBeVisible()
    expect(within(dialog).getByText(deSettings.finance.lockDialog.description)).toBeVisible()
    expect(updateFinanceSettingsResult.mutateAsync).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: deSettings.finance.lockDialog.confirm }))

    await waitFor(() => {
      expect(updateFinanceSettingsResult.mutateAsync).toHaveBeenCalledWith({
        lock_date: '2026-06-30',
        invoice_prefix: 'RE',
        next_invoice_number: 1,
      })
    })
    expect(toast.success).toHaveBeenCalledWith(deSettings.finance.toast.updated)
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('does not save when the lock date confirmation is cancelled', async () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'RE', next_invoice_number: 1 }
    renderSettings()

    fireEvent.change(lockDateInput(), { target: { value: '2026-06-30' } })
    submitFinanceForm()

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: deCommon.actions.cancel }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(updateFinanceSettingsResult.mutateAsync).not.toHaveBeenCalled()
  })

  it('keeps the confirmation dialog open and shows an error toast when the confirmed save fails', async () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'RE', next_invoice_number: 1 }
    updateFinanceSettingsResult.mutateAsync.mockRejectedValueOnce(new Error('boom'))
    renderSettings()

    fireEvent.change(lockDateInput(), { target: { value: '2026-06-30' } })
    submitFinanceForm()

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: deSettings.finance.lockDialog.confirm }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(deSettings.finance.toast.updateFailed)
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps unsaved finance edits when switching to another tab and back', async () => {
    renderSettings()

    fireEvent.change(screen.getByLabelText(deSettings.finance.invoicing.prefix), { target: { value: 'XX' } })
    fireEvent.click(screen.getByRole('tab', { name: tabNames.labor }))
    await waitFor(() => {
      expect(screen.getByText('Labor tab content')).toBeVisible()
    })

    fireEvent.click(screen.getByRole('tab', { name: tabNames.finance }))

    await waitFor(() => {
      expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toHaveValue('XX')
    })
  })
})

describe('SettingsPage characterization: finance sub tabs', () => {
  it('shows the fiscal form first and the accounting export sub tab for admins', () => {
    renderSettings()

    const subTabList = screen.getAllByRole('tablist')[1]
    const labels = within(subTabList).getAllByRole('tab').map((tab) => tab.textContent)
    expect(labels).toEqual([deSettings.finance.subTabs.fiscal, deSettings.finance.subTabs.accountingExport])
  })

  it('hides the accounting export sub tab for non-admins', () => {
    setRole('SALES')
    renderSettings()

    const subTabList = screen.getAllByRole('tablist')[1]
    const labels = within(subTabList).getAllByRole('tab').map((tab) => tab.textContent)
    expect(labels).toEqual([deSettings.finance.subTabs.fiscal])
  })
})

describe('SettingsPage characterization: accounting export sub tab', () => {
  it('switches to the accounting export panel inside the finance tab', () => {
    renderSettings()

    fireEvent.click(screen.getByRole('tab', { name: deSettings.finance.subTabs.accountingExport }))

    expect(screen.getByText('Accounting export tab content')).toBeVisible()
    expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
  })
})
