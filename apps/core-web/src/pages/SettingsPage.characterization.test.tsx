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
  return (
    <>
      <div data-testid='location-pathname'>{location.pathname}</div>
      <div data-testid='location-search'>{location.search}</div>
    </>
  )
}

function renderSettings(path = '') {
  return render(
    <MemoryRouter initialEntries={[`/settings${path}`]}>
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
        <Route
          path='/settings/:section'
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
  [tabNames.auditLogs, 'audit-logs', 'Audit logs tab content'],
] as const

const openTabs = [
  [tabNames.voiceTranslation, 'voice-translation', 'Voice translation tab content'],
  [tabNames.revenueGroups, 'revenue-groups', 'Revenue groups table (0)'],
  [tabNames.brands, 'brands', 'Brands table (0)'],
  [tabNames.employees, 'employees', 'Employees tab content'],
  [tabNames.bays, 'bays', 'Bays tab content'],
  [tabNames.hours, 'hours', 'Hours tab content'],
  [tabNames.labor, 'labor', 'Labor tab content'],
  [tabNames.notifications, 'notifications', 'Notifications tab content'],
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

  it('renders the page title without explanatory subtitle or lock-date helper once the session is loaded', () => {
    renderSettings()

    expect(screen.getByRole('heading', { level: 1, name: deSettings.page.title })).toBeVisible()
    expect(screen.queryByText(deSettings.page.description)).not.toBeInTheDocument()
    expect(screen.queryByText(deSettings.finance.fiscal.lockDateHint)).not.toBeInTheDocument()
  })
})

describe('SettingsPage characterization: overview visibility by role', () => {
  it.each(['ADMIN', 'OWNER'])('shows every section tile to %s in the documented groups', (role) => {
    setRole(role)
    renderSettings()

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual([
      '/settings/legal-entities',
      '/settings/sites',
      '/settings/brands',
      '/settings/employees',
      '/settings/team',
      '/settings/bays',
      '/settings/hours',
      '/settings/labor',
      '/settings/locations',
      '/settings/vehicle-data',
      '/settings/finance',
      '/settings/revenue-groups',
      '/settings/margin-rules',
      '/settings/voice-translation',
      '/settings/data-import',
      '/settings/api-keys',
      '/settings/audit-logs',
      '/settings/notifications',
    ])
  })

  it.each(['SALES', 'TECH'])('hides the admin-only tiles from %s', (role) => {
    setRole(role)
    renderSettings()

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual([
      '/settings/brands',
      '/settings/employees',
      '/settings/bays',
      '/settings/hours',
      '/settings/labor',
      '/settings/locations',
      '/settings/finance',
      '/settings/revenue-groups',
      '/settings/voice-translation',
      '/settings/notifications',
    ])
  })

  it('treats a missing session like a non-admin', () => {
    authSessionResult.data = undefined
    renderSettings()

    expect(screen.queryByRole('link', { name: new RegExp(tabNames.team) })).not.toBeInTheDocument()
  })
})

describe('SettingsPage characterization: section resolution and redirects', () => {
  it('renders the overview on /settings without opening finance', () => {
    renderSettings()

    expect(screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
    expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
  })

  it.each(['?tab=does-not-exist', '/does-not-exist'])(
    'redirects unknown %s to the overview without opening finance',
    async (entry) => {
      renderSettings(entry)

      await waitFor(() => {
        expect(screen.getByTestId('location-pathname')).toHaveTextContent('/settings')
      })
      expect(screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
      expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
    },
  )

  it.each(openTabs)('opens %s from /settings/%s for an admin', (label, value, content) => {
    renderSettings(`/${value}`)

    expect(screen.getByRole('heading', { level: 1, name: label })).toBeVisible()
    expect(screen.getByText(content)).toBeVisible()
  })

  it.each(privilegedTabs)('opens %s from /settings/%s for an admin', (label, value, content) => {
    renderSettings(`/${value}`)

    expect(screen.getByRole('heading', { level: 1, name: label })).toBeVisible()
    expect(screen.getByText(content)).toBeVisible()
  })

  it.each(privilegedTabs)(
    'redirects /settings/%s to the overview when the role is not admin or owner',
    async (_label, value, content) => {
      setRole('SALES')
      renderSettings(`/${value}`)

      await waitFor(() => {
        expect(screen.getByTestId('location-pathname')).toHaveTextContent('/settings')
      })
      expect(screen.queryByText(content)).not.toBeInTheDocument()
      expect(screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
    },
  )

  it('opens the storage locations section', () => {
    renderSettings('/locations')

    expect(screen.getByRole('heading', { level: 1, name: tabNames.locations })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: deSettings.storageLocations.title })).toBeVisible()
  })
})

describe('SettingsPage characterization: revenue groups and brands tabs', () => {
  it('shows the revenue groups heading, the add dialog trigger and the table with the loaded groups', () => {
    revenueGroupsResult.data = [{ id: 'g1' }, { id: 'g2' }] as never
    renderSettings('/revenue-groups')

    expect(screen.getByRole('heading', { level: 2, name: deSettings.revenueGroups.title })).toBeVisible()
    expect(screen.getByText(deSettings.revenueGroups.description)).toBeVisible()
    expect(screen.getByRole('button', { name: '+ Group' })).toBeVisible()
    expect(screen.getByText('Revenue groups table (2)')).toBeVisible()
  })

  it('WHEN the revenue groups load THEN a Skeleton is shown instead of the table and a spinner', () => {
    revenueGroupsResult.isLoading = true
    revenueGroupsResult.data = undefined as never
    const { container } = renderSettings('/revenue-groups')

    expect(screen.queryByText(/Revenue groups table/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(container.querySelector('svg.animate-spin')).toBeNull()
  })

  it('passes an empty list to the revenue groups table when no data is available', () => {
    revenueGroupsResult.data = undefined as never
    renderSettings('/revenue-groups')

    expect(screen.getByText('Revenue groups table (0)')).toBeVisible()
  })

  it('shows the brands heading and the table with the loaded brands', () => {
    brandsResult.data = [{ name: 'Audi' }] as never
    renderSettings('/brands')

    expect(screen.getByRole('heading', { level: 2, name: deSettings.brands.title })).toBeVisible()
    expect(screen.getByText(deSettings.brands.description)).toBeVisible()
    expect(screen.getByText('Brands table (1)')).toBeVisible()
  })

  it('WHEN the brands load THEN a Skeleton is shown instead of the table, and an empty list without data', () => {
    brandsResult.isLoading = true
    brandsResult.data = undefined as never
    const { container, unmount } = renderSettings('/brands')

    expect(screen.queryByText(/Brands table/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(container.querySelector('svg.animate-spin')).toBeNull()
    unmount()

    brandsResult.isLoading = false
    renderSettings('/brands')
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
  it('WHEN the finance settings load THEN a Skeleton is shown instead of the form and a spinner', () => {
    financeSettingsResult.isLoading = true
    financeSettingsResult.data = undefined as never
    const { container } = renderSettings('/finance')

    expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(container.querySelector('svg.animate-spin')).toBeNull()
  })

  it('fills the form from the loaded settings and shows the lock date as TT.MM.JJJJ', () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'INV', next_invoice_number: 42 }
    renderSettings('/finance')

    expect(lockDateInput()).toHaveValue('31.03.2026')
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toHaveValue('INV')
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toHaveValue(42)
  })

  it('shows an empty lock date when none is set', () => {
    renderSettings('/finance')

    expect(lockDateInput()).toHaveValue('')
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toHaveValue('RE')
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toHaveValue(1)
  })

  it('starts with an empty form while no settings are loaded', () => {
    financeSettingsResult.data = undefined as never
    renderSettings('/finance')

    expect(lockDateInput()).toHaveValue('')
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toHaveValue('')
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toHaveValue(0)
  })

  it('renders finance settings fields as read-only and hides the save button for SALES role', () => {
    setRole('SALES')
    renderSettings('/finance')

    expect(lockDateInput()).toBeDisabled()
    expect(screen.getByLabelText(deSettings.finance.invoicing.prefix)).toBeDisabled()
    expect(screen.getByLabelText(deSettings.finance.invoicing.nextNumber)).toBeDisabled()
    expect(screen.queryByRole('button', { name: deSettings.finance.saveChanges })).not.toBeInTheDocument()
  })

  it('saves edited values directly when there is no existing lock date and shows a success toast', async () => {
    renderSettings('/finance')

    fireEvent.change(lockDateInput(), { target: { value: '01.05.2026' } })
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

  it('omits an unedited lock date and coerces an unparsable invoice number to 0', async () => {
    renderSettings('/finance')

    fireEvent.change(screen.getByLabelText(deSettings.finance.invoicing.nextNumber), { target: { value: '' } })
    submitFinanceForm()

    await waitFor(() => {
      expect(updateFinanceSettingsResult.mutateAsync).toHaveBeenCalledWith({
        invoice_prefix: 'RE',
        next_invoice_number: 0,
      })
    })
  })

  it('shows an error toast when saving fails', async () => {
    updateFinanceSettingsResult.mutateAsync.mockRejectedValueOnce(new Error('boom'))
    renderSettings('/finance')

    submitFinanceForm()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(deSettings.finance.toast.updateFailed)
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('disables the submit button while the update is pending', () => {
    updateFinanceSettingsResult.isPending = true
    renderSettings('/finance')

    expect(screen.getByRole('button', { name: deSettings.finance.saveChanges })).toBeDisabled()
  })

  it('saves directly when the new lock date is not later than the existing one', async () => {
    financeSettingsResult.data = { lock_date: '2026-03-31T12:00:00.000Z', invoice_prefix: 'RE', next_invoice_number: 1 }
    renderSettings('/finance')

    fireEvent.change(lockDateInput(), { target: { value: '01.02.2026' } })
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
    renderSettings('/finance')

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
    renderSettings('/finance')

    fireEvent.change(lockDateInput(), { target: { value: '30.06.2026' } })
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
    renderSettings('/finance')

    fireEvent.change(lockDateInput(), { target: { value: '30.06.2026' } })
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
    renderSettings('/finance')

    fireEvent.change(lockDateInput(), { target: { value: '30.06.2026' } })
    submitFinanceForm()

    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: deSettings.finance.lockDialog.confirm }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(deSettings.finance.toast.updateFailed)
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

})

describe('SettingsPage characterization: finance sub tabs', () => {
  it('shows the fiscal form first and the accounting export sub tab for admins', () => {
    renderSettings('/finance')

    const subTabList = screen.getAllByRole('tablist')[0]
    const labels = within(subTabList).getAllByRole('tab').map((tab) => tab.textContent)
    expect(labels).toEqual([deSettings.finance.subTabs.fiscal, deSettings.finance.subTabs.accountingExport])
  })

  it('hides the accounting export sub tab for non-admins', () => {
    setRole('SALES')
    renderSettings('/finance')

    const subTabList = screen.getAllByRole('tablist')[0]
    const labels = within(subTabList).getAllByRole('tab').map((tab) => tab.textContent)
    expect(labels).toEqual([deSettings.finance.subTabs.fiscal])
  })
})

describe('SettingsPage characterization: accounting export sub tab', () => {
  it('switches to the accounting export panel inside the finance tab', () => {
    renderSettings('/finance')

    fireEvent.click(screen.getByRole('tab', { name: deSettings.finance.subTabs.accountingExport }))

    expect(screen.getByText('Accounting export tab content')).toBeVisible()
    expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
  })

  it('opens the accounting export panel on the export profile deep link (AUT-852)', async () => {
    renderSettings('?tab=finance&subtab=accounting-export')

    expect(await screen.findByText('Accounting export tab content')).toBeVisible()
    expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
  })
})
