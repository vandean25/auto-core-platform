import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaletteContextAction } from '@/components/global-search/global-search-context-actions'
import { registerGermanUiForTests } from '@/test/german-ui'
import { EntityPeekFooter } from './EntityPeekFooter'

registerGermanUiForTests()

const onExport = vi.fn()
const onAssign = vi.fn()
const onDelete = vi.fn()

function actions(): PaletteContextAction[] {
  return [
    { id: 'workOrder.jobCardPdf', label: 'Auftragskarte (PDF)', description: '', onSelect: onExport },
    {
      id: 'workOrder.assignMechanic',
      label: 'Mechaniker zuweisen',
      description: '',
      onSelect: vi.fn(),
      children: [
        { id: 'workOrder.assignMechanic.max', label: 'Max', description: '', onSelect: onAssign },
      ],
    },
    { id: 'customer.delete', label: 'Löschen', description: '', destructive: true, onSelect: onDelete },
  ]
}

function renderFooter(moreActions: PaletteContextAction[] = actions()) {
  return render(
    <MemoryRouter>
      <EntityPeekFooter openInFullHref="/customers/cust-1" moreActions={moreActions} />
    </MemoryRouter>,
  )
}

function openDropdown(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

beforeEach(() => {
  setViewportWidth(1280)
  window.matchMedia =
    window.matchMedia ??
    ((query: string) =>
      ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EntityPeekFooter (AUT-783)', () => {
  it('is one row: a flex-1 Öffnen link and a 44px icon button named "Weitere Aktionen"', () => {
    renderFooter()

    const open = screen.getByRole('link', { name: 'Öffnen' })
    const more = screen.getByRole('button', { name: 'Weitere Aktionen' })
    expect(open).toHaveAttribute('href', '/customers/cust-1')
    expect(open.className).toContain('flex-1')
    expect(open.className).toContain('min-h-11')
    expect(more.className).toContain('min-h-11')
    expect(more.className).toContain('min-w-11')
    expect(open.parentElement).toBe(more.parentElement)
    expect(open.parentElement?.className).toContain('safe-area-inset-bottom')
    expect(screen.queryByText('Aktionen')).not.toBeInTheDocument()
  })

  it('shows no destructive action before the menu is opened', () => {
    renderFooter()

    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Löschen' })).not.toBeInTheDocument()
  })

  it('hides the ⋯ button when no action remains', () => {
    renderFooter([])

    expect(screen.getByRole('link', { name: 'Öffnen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).not.toBeInTheDocument()
  })

  describe('from md up (dropdown menu)', () => {
    it('lists the actions with the destructive one last, after a separator, in text-destructive', async () => {
      renderFooter()

      openDropdown(screen.getByRole('button', { name: 'Weitere Aktionen' }))

      const menu = await screen.findByRole('menu')
      const items = within(menu).getAllByRole('menuitem')
      expect(items.map((item) => item.getAttribute('data-action-id'))).toEqual([
        'workOrder.jobCardPdf',
        'workOrder.assignMechanic',
        'customer.delete',
      ])
      expect(items[2].className).toContain('text-destructive')
      expect(items[2].className).not.toContain('bg-destructive')
      expect(within(menu).getAllByRole('separator')).toHaveLength(1)
      const [separator] = within(menu).getAllByRole('separator')
      expect(separator.compareDocumentPosition(items[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('runs an action and closes the menu', async () => {
      renderFooter()

      openDropdown(screen.getByRole('button', { name: 'Weitere Aktionen' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Auftragskarte (PDF)' }))

      expect(onExport).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('reaches nested children through a submenu', async () => {
      renderFooter()

      openDropdown(screen.getByRole('button', { name: 'Weitere Aktionen' }))
      const parent = await screen.findByRole('menuitem', { name: 'Mechaniker zuweisen' })
      parent.focus()
      fireEvent.keyDown(parent, { key: 'ArrowRight' })
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Max' }))

      expect(onAssign).toHaveBeenCalledTimes(1)
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      renderFooter()
      const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' })

      openDropdown(trigger)
      const menu = await screen.findByRole('menu')
      fireEvent.keyDown(menu, { key: 'Escape' })

      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      await waitFor(() => expect(trigger).toHaveFocus())
    })
  })

  describe('below md (bottom sheet)', () => {
    beforeEach(() => setViewportWidth(375))

    it('opens a bottom sheet with touch-sized rows, nested choices and the destructive one last', async () => {
      renderFooter()

      fireEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }))

      const sheet = await screen.findByTestId('entity-peek-more-actions')
      const rows = within(sheet).getAllByRole('button').filter((button) => button.hasAttribute('data-action-id'))
      expect(rows.map((row) => row.getAttribute('data-action-id'))).toEqual([
        'workOrder.jobCardPdf',
        'workOrder.assignMechanic.max',
        'customer.delete',
      ])
      expect(rows.every((row) => row.className.includes('min-h-11'))).toBe(true)
      expect(rows[2].className).toContain('text-destructive')
      expect(within(sheet).getByRole('group', { name: 'Mechaniker zuweisen' })).toBeInTheDocument()
    })

    it('runs an action and closes the sheet', async () => {
      renderFooter()

      fireEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }))
      const sheet = await screen.findByTestId('entity-peek-more-actions')
      fireEvent.click(within(sheet).getByRole('button', { name: 'Löschen' }))

      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('entity-peek-more-actions')).not.toBeInTheDocument()
    })

    it('closes on Escape and returns focus to the trigger', async () => {
      renderFooter()
      const trigger = screen.getByRole('button', { name: 'Weitere Aktionen' })

      fireEvent.click(trigger)
      const sheet = await screen.findByTestId('entity-peek-more-actions')
      await act(async () => {
        fireEvent.keyDown(sheet, { key: 'Escape' })
      })

      await waitFor(() => expect(screen.queryByTestId('entity-peek-more-actions')).not.toBeInTheDocument())
      await waitFor(() => expect(trigger).toHaveFocus())
    })
  })
})
