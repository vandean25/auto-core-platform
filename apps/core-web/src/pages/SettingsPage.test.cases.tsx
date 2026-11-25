import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import deSettings from '../../../../locales/de/settings.json'
import SettingsPage from './SettingsPage'
import { authSessionResult } from './SettingsPage.test.support.test'

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid='location-pathname'>{location.pathname}</div>
      <div data-testid='location-search'>{location.search}</div>
      <div data-testid='location-hash'>{location.hash}</div>
    </>
  )
}

function renderSettingsRouter(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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

beforeEach(() => {
  authSessionResult.data = { activeRole: 'ADMIN' }
  authSessionResult.isLoading = false
})

describe('SettingsPage overview & subpage routing (AUT-1051)', () => {
  it('renders the grouped overview on /settings without tab strip or select', () => {
    renderSettingsRouter('/settings')

    expect(screen.queryByTestId('settings-tab-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-select')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: deSettings.groups.company })).toBeVisible()
  })

  it('opens a section subpage when clicking a tile with breadcrumb and back link', async () => {
    renderSettingsRouter('/settings')

    fireEvent.click(screen.getByRole('link', { name: new RegExp(deSettings.tabs.hours) }))

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/settings/hours')
    })
    expect(screen.getByText('Hours tab content')).toBeVisible()
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(breadcrumb).toHaveTextContent(deSettings.page.title)
    expect(breadcrumb).toHaveTextContent(deSettings.tabs.hours)
    expect(screen.getByRole('link', { name: deSettings.page.backToOverview })).toHaveAttribute('href', '/settings')
    expect(screen.queryByTestId('settings-tab-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-select')).not.toBeInTheDocument()
  })

  it('redirects /settings?tab=hours to /settings/hours', async () => {
    renderSettingsRouter('/settings?tab=hours')

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/settings/hours')
    })
    expect(screen.getByText('Hours tab content')).toBeVisible()
  })

  it('redirects /settings?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=v-1 preserving extra params and hash', async () => {
    renderSettingsRouter('/settings?tab=data-import&entity=SUPPLIER_PRICE_LIST&vendorId=v-1#step-2')

    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/settings/data-import')
    })
    expect(screen.getByTestId('location-search')).toHaveTextContent('?entity=SUPPLIER_PRICE_LIST&vendorId=v-1')
    expect(screen.getByTestId('location-hash')).toHaveTextContent('#step-2')
    expect(screen.getByText('Data import tab content')).toBeVisible()
  })

  it.each(['/settings?tab=does-not-exist', '/settings/does-not-exist'])(
    'redirects unknown %s to the overview, not finance',
    async (entry) => {
      renderSettingsRouter(entry)

      await waitFor(() => {
        expect(screen.getByTestId('location-pathname')).toHaveTextContent('/settings')
        expect(screen.getByTestId('location-search')).toHaveTextContent('')
      })
      expect(screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
      expect(screen.queryByLabelText(deSettings.finance.invoicing.prefix)).not.toBeInTheDocument()
    },
  )

  it.each(['/settings/audit-logs', '/settings?tab=audit-logs'])(
    'redirects non-admin from %s to the overview without rendering admin content',
    async (entry) => {
      authSessionResult.data = { activeRole: 'SALES' }
      renderSettingsRouter(entry)

      await waitFor(() => {
        expect(screen.getByTestId('location-pathname')).toHaveTextContent('/settings')
      })
      expect(screen.queryByText('Audit logs tab content')).not.toBeInTheDocument()
      expect(screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()
    },
  )
})
