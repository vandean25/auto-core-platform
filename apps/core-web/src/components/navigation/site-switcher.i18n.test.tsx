import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeUiLanguage } from '@/lib/i18n'
import { SiteSwitcherShell as SiteSwitcher } from '@/components/navigation/SiteSwitcherShell'
import type { MeSite } from '@/api/sites'

afterEach(cleanup)

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(async () => {
  await changeUiLanguage('de')
})

const vienna: MeSite = {
  id: 'site-vienna',
  code: 'WIEN',
  name: 'Vienna',
  legalEntityId: 'le-1',
  legalEntityName: 'AT GmbH',
}

describe('SiteSwitcher (de)', () => {
  it('shows German labels for the read-only current site', () => {
    render(
      <SiteSwitcher
        activeSiteId={vienna.id}
        sites={[vienna]}
        isLoadingSites={false}
        isSwitching={false}
        onSwitch={vi.fn()}
      />,
    )

    expect(screen.getByText('Aktueller Standort')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Standort wechseln' })).not.toBeInTheDocument()
  })

  it('activates a site from the German recovery prompt', () => {
    const onSwitch = vi.fn()

    render(
      <SiteSwitcher
        activeSiteId={null}
        sites={[vienna]}
        isLoadingSites={false}
        isSwitching={false}
        onSwitch={onSwitch}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Vienna aktivieren' }))
    expect(onSwitch).toHaveBeenCalledWith('site-vienna')
  })
})
