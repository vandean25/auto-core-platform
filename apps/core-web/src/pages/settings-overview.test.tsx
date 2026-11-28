import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import deSettings from '../../../../locales/de/settings.json'
import { registerGermanUiForTests } from '@/test/german-ui'
import { getVisibleTabs, type SettingsTab } from './settings-page-tabs'
import { SettingsOverview } from '@/components/settings/SettingsOverview'

registerGermanUiForTests()
afterEach(cleanup)

const EXPECTED_GROUPS: Record<string, readonly SettingsTab[]> = {
  [deSettings.groups.company]: ['legal-entities', 'sites', 'brands', 'employees', 'team'],
  [deSettings.groups.workshop]: ['bays', 'hours', 'labor', 'locations', 'vehicle-data'],
  [deSettings.groups.finance]: ['finance', 'revenue-groups', 'margin-rules'],
  [deSettings.groups.system]: ['voice-translation', 'data-import', 'api-keys', 'audit-logs', 'notifications'],
}

function renderOverview(canManage: boolean, customFieldsEnabled = false) {
  return render(
    <MemoryRouter>
      <SettingsOverview visibleTabs={getVisibleTabs(canManage, customFieldsEnabled)} />
    </MemoryRouter>,
  )
}

describe('SettingsOverview (AUT-1051)', () => {
  it('shows all 18 sections for an admin in exactly the 4 documented groups with no tab strip or select', () => {
    renderOverview(true)

    expect(screen.queryByTestId('settings-tab-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-select')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })).toBeVisible()

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(18)
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      Object.values(EXPECTED_GROUPS)
        .flat()
        .map((id) => `/settings/${id}`),
    )

    for (const [groupTitle, tabIds] of Object.entries(EXPECTED_GROUPS)) {
      const heading = screen.getByRole('heading', { level: 2, name: groupTitle })
      const card = heading.closest('[data-testid^="settings-group-"]') as HTMLElement
      expect(card).not.toBeNull()
      const groupLinks = within(card).getAllByRole('link')
      expect(groupLinks.map((link) => link.getAttribute('href'))).toEqual(tabIds.map((id) => `/settings/${id}`))
    }
  })

  it('hides admin-only tiles from non-admins while keeping remaining visible sections in their groups', () => {
    renderOverview(false)

    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
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
    for (const groupTitle of Object.keys(EXPECTED_GROUPS)) {
      expect(screen.getByRole('heading', { level: 2, name: groupTitle })).toBeVisible()
    }
  })

  it('hides a group when all of its tiles are filtered out by a flag or visibility rule', () => {
    render(
      <MemoryRouter>
        <SettingsOverview visibleTabs={['finance', 'revenue-groups']} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 2, name: deSettings.groups.finance })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 2, name: deSettings.groups.company })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: deSettings.groups.workshop })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: deSettings.groups.system })).not.toBeInTheDocument()
  })

  it('filters tiles by title or description fragment, hides empty groups, and restores on clear', () => {
    renderOverview(true)

    const search = screen.getByRole('searchbox', { name: deSettings.overview.searchLabel })
    fireEvent.change(search, { target: { value: 'Hebebühnen' } })

    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/settings/bays'])
    expect(screen.getByRole('heading', { level: 2, name: deSettings.groups.workshop })).toBeVisible()
    expect(screen.queryByRole('heading', { level: 2, name: deSettings.groups.company })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: deSettings.groups.finance })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: deSettings.groups.system })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'does-not-match-anything' } })
    expect(screen.getByText(deSettings.overview.empty)).toBeVisible()

    fireEvent.click(screen.getAllByRole('button', { name: deSettings.overview.clearSearch })[0])
    expect(screen.getAllByRole('link')).toHaveLength(18)
  })

  it('WHEN SettingsOverview renders THEN settings cards show only their title without description', () => {
    renderOverview(true)

    expect(screen.queryByText(deSettings.bays.description)).not.toBeInTheDocument()
    expect(screen.queryByText(deSettings.brands.description)).not.toBeInTheDocument()
  })
})

