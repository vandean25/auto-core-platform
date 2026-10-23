import { cleanup, render, screen, within } from '@testing-library/react'
import { Command, CommandList } from '@/components/ui/command'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchGroup } from '@/api/search'
import { PrefixHelp, RecentItemsGroup, SearchResults } from './GlobalSearchResultGroupsView'

const ACTIVE_SITE = 'site-active'
const result = (type: SearchGroup['type'], id: string, title: string, extra: object = {}) => ({
  type,
  id,
  title,
  subtitle: null,
  href: `/x/${id}`,
  score: 1,
  ...extra,
})

function renderResults(props: Partial<React.ComponentProps<typeof SearchResults>> = {}) {
  const onSelect = vi.fn()
  render(
    <Command shouldFilter={false}>
      <CommandList>
        <SearchResults
          groups={[]}
          isLoading={false}
          error={null}
          hasSections={false}
          activeSiteId={ACTIVE_SITE}
          sites={[
            { id: ACTIVE_SITE, code: 'A', name: 'Wien', legalEntityId: 'le-1' },
            { id: 'site-other', code: 'B', name: 'Graz', legalEntityId: 'le-1' },
          ]}
          query="muster"
          onSelect={onSelect}
          {...props}
        />
      </CommandList>
    </Command>,
  )
  return onSelect
}

describe('SearchResults', () => {
  afterEach(cleanup)

  it('renders the groups in the order received, each with its label', () => {
    renderResults({
      groups: [
        { type: 'customer', results: [result('customer', 'c1', 'Erika Muster')] },
        { type: 'workshop_order', results: [result('workshop_order', 'w1', 'WO-2026-0001')] },
        { type: 'part', results: [result('part', 'p1', 'Bremsscheibe')] },
      ],
    })

    const headings = screen.getAllByText(/^(Kunden|Werkstattaufträge|Teile)$/).map((el) => el.textContent)
    expect(headings).toEqual(['Kunden', 'Werkstattaufträge', 'Teile'])
    expect(screen.getByText('Erika Muster')).toBeInTheDocument()
  })

  it('keeps the other groups when one group is unavailable', () => {
    renderResults({
      groups: [
        { type: 'customer', results: [], error: 'unavailable' },
        { type: 'vehicle', results: [result('vehicle', 'v1', 'W-12345AB')] },
      ],
    })

    expect(screen.getByRole('status')).toHaveTextContent('Diese Ergebnisse sind vorübergehend nicht verfügbar.')
    expect(screen.getByText('Kunden')).toBeInTheDocument()
    expect(screen.getByText('W-12345AB')).toBeInTheDocument()
    expect(screen.queryByText('Suche vorübergehend nicht verfügbar.')).not.toBeInTheDocument()
  })

  it('does not render a group without results or error (a type the role may not see)', () => {
    renderResults({
      groups: [
        { type: 'invoice', results: [] },
        { type: 'customer', results: [result('customer', 'c1', 'Erika Muster')] },
      ],
    })

    expect(screen.queryByText('Rechnungen')).not.toBeInTheDocument()
  })

  it('badges a hit of another site with the site name, and an unknown site generically', () => {
    renderResults({
      groups: [
        {
          type: 'workshop_order',
          results: [
            result('workshop_order', 'w1', 'WO-ACTIVE', { siteId: ACTIVE_SITE }),
            result('workshop_order', 'w2', 'WO-GRAZ', { siteId: 'site-other' }),
            result('workshop_order', 'w3', 'WO-GONE', { siteId: 'site-unknown' }),
          ],
        },
      ],
    })

    const row = (title: string) => screen.getByText(title).closest('[cmdk-item]') as HTMLElement
    expect(within(row('WO-ACTIVE')).queryByText('Wien')).not.toBeInTheDocument()
    expect(within(row('WO-GRAZ')).getByText('Graz')).toBeInTheDocument()
    expect(within(row('WO-GONE')).getByText('Anderer Standort')).toBeInTheDocument()
  })

  it('shows skeleton rows while loading, without a searching text or empty message', () => {
    renderResults({ isLoading: true })

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText(/Suche…/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Keine Teile/)).not.toBeInTheDocument()
  })

  it('shows the whole-request failure as the unavailable state', () => {
    renderResults({ error: new Error('boom') })

    expect(screen.getByText('Suche vorübergehend nicht verfügbar.')).toBeInTheDocument()
  })

  it('shows the no-match message only when nothing else is on offer', () => {
    renderResults()
    expect(screen.getByText(/Keine Teile, Kunden, Fahrzeuge, Aufträge oder Befehle passen zu „muster“/)).toBeInTheDocument()

    cleanup()
    renderResults({ hasSections: true })
    expect(screen.queryByText(/passen zu/)).not.toBeInTheDocument()
  })

  it('selects the result that was clicked', () => {
    const onSelect = renderResults({
      groups: [{ type: 'customer', results: [result('customer', 'c1', 'Erika Muster')] }],
    })

    screen.getByText('Erika Muster').click()

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', href: '/x/c1' }))
  })
})

describe('RecentItemsGroup', () => {
  afterEach(cleanup)

  const item = { type: 'customer' as const, id: 'c1', title: 'Erika Muster', subtitle: null, href: '/customers/c1' }

  it('lists recent items and removes one without selecting it', () => {
    const onSelect = vi.fn()
    const onRemove = vi.fn()
    render(
      <Command shouldFilter={false}>
        <CommandList>
          <RecentItemsGroup items={[item]} onSelect={onSelect} onRemove={onRemove} />
        </CommandList>
      </Command>,
    )

    expect(screen.getByText('Zuletzt geöffnet')).toBeInTheDocument()
    screen.getByRole('button', { name: /Erika Muster.*entfernen/ }).click()

    expect(onRemove).toHaveBeenCalledWith(item)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders nothing without items', () => {
    const { container } = render(<RecentItemsGroup items={[]} onSelect={vi.fn()} onRemove={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('PrefixHelp', () => {
  it('lists every prefix with its type label', () => {
    render(<PrefixHelp />)

    for (const prefix of ['k:', 'fz:', 'a:', 'r:', 't:']) expect(screen.getByText(prefix)).toBeInTheDocument()
    expect(screen.getByText(/Werkstattaufträge/)).toBeInTheDocument()
  })
})
