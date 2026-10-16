import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SiteSwitcher } from '@/components/navigation/SiteSwitcher'
import type { MeSite } from '@/api/sites'

afterEach(cleanup)

beforeAll(() => {
  // Radix Select auto-scrolls the selected item on open (jsdom lacks it).
  Element.prototype.scrollIntoView = vi.fn()
})

const vienna: MeSite = {
  id: 'site-vienna',
  code: 'WIEN',
  name: 'Vienna',
  legalEntityId: 'le-1',
  legalEntityName: 'AT GmbH',
}

const munich: MeSite = {
  id: 'site-munich',
  code: 'MUC',
  name: 'Munich',
  legalEntityId: 'le-1',
  legalEntityName: 'AT GmbH',
}

describe('SiteSwitcher', () => {
  it('shows a read-only current site when the single active grant is already active', () => {
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
    expect(screen.getByText('Vienna')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Standort wechseln' })).not.toBeInTheDocument()
  })

  it('shows a recovery prompt when active_site_id is null despite one grant', () => {
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

    expect(screen.getByText('Kein aktiver Standort')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Vienna aktivieren' }))
    expect(onSwitch).toHaveBeenCalledWith('site-vienna')
  })

  it('allows selecting a site during multi-site recovery', async () => {
    const onSwitch = vi.fn()

    render(
      <SiteSwitcher
        activeSiteId={null}
        sites={[vienna, munich]}
        isLoadingSites={false}
        isSwitching={false}
        onSwitch={onSwitch}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Standort wechseln' }))
    fireEvent.click(await screen.findByRole('option', { name: /Munich/ }))

    expect(onSwitch).toHaveBeenCalledWith('site-munich')
  })

  it('renders the current site with a dropdown of switchable sites', () => {
    const onSwitch = vi.fn()

    render(
      <SiteSwitcher
        activeSiteId={vienna.id}
        sites={[vienna, munich]}
        isLoadingSites={false}
        isSwitching={false}
        onSwitch={onSwitch}
      />,
    )

    expect(screen.getByText('Aktueller Standort')).toBeInTheDocument()
    expect(screen.getByText('Vienna')).toBeInTheDocument()
  })

  it('switches sites from the dropdown', async () => {
    const onSwitch = vi.fn()

    render(
      <SiteSwitcher
        activeSiteId={vienna.id}
        sites={[vienna, munich]}
        isLoadingSites={false}
        isSwitching={false}
        onSwitch={onSwitch}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: 'Standort wechseln' }))
    const option = await screen.findByRole('option', { name: /Munich/ })
    fireEvent.click(option)

    expect(onSwitch).toHaveBeenCalledWith('site-munich')
  })

  it('renders nothing when there are no sites at all', () => {
    const { container } = render(
      <SiteSwitcher
        activeSiteId={null}
        sites={[]}
        isLoadingSites={false}
        isSwitching={false}
        onSwitch={vi.fn()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
