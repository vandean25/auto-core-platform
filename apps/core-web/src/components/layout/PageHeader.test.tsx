import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'

afterEach(cleanup)

describe('PageHeader', () => {
  it('renders the title as the page h1 with description and actions', () => {
    render(<PageHeader title="Kunden" description="Kundenstamm verwalten." actions={<button type="button">Kunde</button>} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Kunden' })).toBeInTheDocument()
    expect(screen.getByText('Kundenstamm verwalten.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kunde' })).toBeInTheDocument()
  })

  it('renders breadcrumbs, leading element and the tabs row', () => {
    render(
      <PageHeader title="Detail" breadcrumbs={<nav aria-label="Pfad" />} leading={<span>zurück</span>}>
        <div role="tablist" aria-label="Reiter" />
      </PageHeader>,
    )

    expect(screen.getByRole('navigation', { name: 'Pfad' })).toBeInTheDocument()
    expect(screen.getByText('zurück')).toBeInTheDocument()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
  })

  it('omits the actions wrapper and description when not given', () => {
    const { container } = render(<PageHeader title="Nur Titel" />)

    expect(container.querySelector('header > div')?.children).toHaveLength(1)
    expect(screen.queryByText('Nur Titel')?.nextElementSibling).toBeNull()
  })

  it('lets actions wrap on narrow screens', () => {
    render(<PageHeader title="Titel" actions={<button type="button">Aktion</button>} />)

    expect(screen.getByRole('button', { name: 'Aktion' }).parentElement).toHaveClass('flex-wrap')
  })
})
