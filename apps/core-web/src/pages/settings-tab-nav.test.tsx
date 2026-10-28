import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Tabs } from '@/components/ui/tabs'
import { registerGermanUiForTests } from '@/test/german-ui'
import { getVisibleTabs, type SettingsTab } from './settings-page-tabs'
import { SettingsTabNav } from './settings-tab-nav'

registerGermanUiForTests()
afterEach(cleanup)

const tabs = getVisibleTabs(true)
const labels = Object.fromEntries(tabs.map((tab) => [tab, `Label ${tab}`])) as Record<SettingsTab, string>

function renderNav(active: SettingsTab) {
  return render(
    <Tabs value={active}>
      <SettingsTabNav tabs={tabs} labels={labels} active={active} onChange={() => undefined} />
    </Tabs>,
  )
}

describe('SettingsTabNav (AUT-754)', () => {
  it.each(['locations', 'labor', 'hours'] as const)('shows %s as the selected section of the phone select', (tab) => {
    renderNav(tab)

    expect(screen.getByTestId('settings-section-select')).toHaveTextContent(labels[tab])
    expect(screen.getByTestId('settings-section-select')).not.toHaveTextContent(labels.finance)
  })

  it('marks exactly the active tab in the strip', () => {
    renderNav('labor')

    const selected = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('data-state') === 'active')
    expect(selected.map((tab) => tab.textContent)).toEqual([labels.labor])
  })
})
