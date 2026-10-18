import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { SaveCurrentViewButton } from './SaveCurrentViewButton'

const TRIGGER_NAME = 'Als Seitenleisten-Ansicht für Customers speichern'
const TOOLTIP = 'Speichert diese Filter als Shortcut in den Favoriten'

function renderSaveButton() {
  return render(
    <MemoryRouter initialEntries={['/customers?search=klaus']}>
      <SavedViewsProvider userKey="test-user">
        <SaveCurrentViewButton title="Customers" />
      </SavedViewsProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('SaveCurrentViewButton', () => {
  it('names the trigger with the sidebar-view label and no longer with "Save View"', () => {
    renderSaveButton()

    expect(screen.getByRole('button', { name: TRIGGER_NAME })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save view/i })).not.toBeInTheDocument()
  })

  it('shows its one-line tooltip when the trigger receives keyboard focus', async () => {
    renderSaveButton()

    act(() => screen.getByRole('button', { name: TRIGGER_NAME }).focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(TOOLTIP)
  })

  it('shows its one-line tooltip on hover', async () => {
    renderSaveButton()

    fireEvent.pointerMove(screen.getByRole('button', { name: TRIGGER_NAME }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(TOOLTIP)
  })

  it('dismisses the tooltip when Escape is pressed', async () => {
    renderSaveButton()
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME })
    act(() => trigger.focus())
    await screen.findByRole('tooltip')

    fireEvent.keyDown(trigger, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('opens the renamed dialog and saves the view to Favorites', async () => {
    renderSaveButton()

    fireEvent.click(screen.getByRole('button', { name: TRIGGER_NAME }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Als Seitenleisten-Ansicht speichern' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('acp:saved-views:test-user') ?? '[]')
      expect(stored).toEqual([
        expect.objectContaining({ name: 'Customers Ansicht', href: '/customers?search=klaus' }),
      ])
    })
  })
})
