import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import deSettings from '../../../../locales/de/settings.json'
import SettingsPage from './SettingsPage'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid='location-search'>{location.search}</div>
}

describe('SettingsPage tab integration', () => {
  it('keeps the settings tab bar scrollable without shrinking tab labels', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path='/settings' element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const [mainTabList] = screen.getAllByRole('tablist')
    expect(mainTabList).toHaveClass('h-auto', 'overflow-x-auto')
    expect(screen.getByRole('tab', { name: deSettings.tabs.voiceTranslation })).toHaveClass('shrink-0')
    expect(screen.getByRole('tab', { name: deSettings.tabs.locations })).toHaveClass('shrink-0')
  })

  it('renders Employees, Bays, and Audit Logs triggers and respects the initial employees query param', async () => {
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

    expect(screen.getByRole('tab', { name: deSettings.tabs.employees })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.bays })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.hours })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.vehicleData })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.legalEntities })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.sites })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.marginRules })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.team })).toBeVisible()
    expect(screen.getByRole('tab', { name: deSettings.tabs.auditLogs })).toBeVisible()
    expect(screen.getByText('Employees tab content')).toBeVisible()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=employees')

    fireEvent.click(screen.getByRole('tab', { name: deSettings.tabs.bays }))

    await waitFor(() => {
      expect(screen.getByText('Bays tab content')).toBeVisible()
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=bays')
    })

    fireEvent.click(screen.getByRole('tab', { name: deSettings.tabs.vehicleData }))

    await waitFor(() => {
      expect(screen.getByText('Vehicle data tab content')).toBeVisible()
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=vehicle-data')
    })

    fireEvent.click(screen.getByRole('tab', { name: deSettings.tabs.marginRules }))

    await waitFor(() => {
      expect(screen.getByText('Margin rules tab content')).toBeVisible()
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=margin-rules')
    })

    fireEvent.click(screen.getByRole('tab', { name: deSettings.tabs.auditLogs }))

    await waitFor(() => {
      expect(screen.getByText('Audit logs tab content')).toBeVisible()
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=audit-logs')
    })
  })

  it('activates Margenregeln tab panel when initial tab is margin-rules', async () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=margin-rules']}>
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

    expect(screen.getByRole('tab', { name: deSettings.tabs.marginRules })).toBeVisible()
    expect(screen.getByText('Margin rules tab content')).toBeVisible()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=margin-rules')
  })
})
