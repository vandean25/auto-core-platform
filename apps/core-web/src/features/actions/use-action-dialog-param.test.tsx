import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildActionDialogHref, useActionDialogParam, useActionParamOpen } from './use-action-dialog-param'

function ActionDialogHarness({ actionId }: { actionId: string | readonly string[] }) {
  const location = useLocation()
  const { open, onOpenChange } = useActionDialogParam(actionId)

  return (
    <div>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={() => onOpenChange(true)}>
        open-dialog
      </button>
      {open ? (
        <div role="dialog">
          <span>dialog-open</span>
          <button type="button" onClick={() => onOpenChange(false)}>
            close-dialog
          </button>
        </div>
      ) : null}
    </div>
  )
}

describe('useActionDialogParam', () => {
  afterEach(cleanup)

  it('opens on initial render when ?action=<id> is present and removes the param on close', () => {
    render(
      <MemoryRouter initialEntries={[buildActionDialogHref('/customers', 'customer.create', '?page=2')]}>
        <ActionDialogHarness actionId={['create', 'customer.create']} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent('dialog-open')
    expect(screen.getByTestId('search')).toHaveTextContent('?page=2&action=customer.create')

    fireEvent.click(screen.getByRole('button', { name: 'close-dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('?page=2')
  })

  it('sets ?action=<id> when opened imperatively and clears it when closed', () => {
    render(
      <MemoryRouter initialEntries={['/customers']}>
        <ActionDialogHarness actionId="customer.create" />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'open-dialog' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('?action=customer.create')
  })
})

function OpenerHarness({ onOpen }: { onOpen: () => void }) {
  useActionParamOpen(['create', 'appointment.create'], onOpen)
  return <span data-testid="search">{useLocation().search}</span>
}

describe('useActionParamOpen', () => {
  afterEach(cleanup)

  it('opens once for a matching ?action and removes only that param', () => {
    const onOpen = vi.fn()
    render(
      <MemoryRouter initialEntries={['/workshop/planner?date=2026-08-21&action=create']}>
        <OpenerHarness onOpen={onOpen} />
      </MemoryRouter>,
    )

    expect(onOpen).toHaveBeenCalled()
    expect(screen.getByTestId('search')).toHaveTextContent('?date=2026-08-21')
    expect(screen.getByTestId('search')).not.toHaveTextContent('action')
  })

  it('ignores other or missing action ids', () => {
    const onOpen = vi.fn()
    render(
      <MemoryRouter initialEntries={['/workshop/planner?action=other']}>
        <OpenerHarness onOpen={onOpen} />
      </MemoryRouter>,
    )

    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByTestId('search')).toHaveTextContent('?action=other')
  })
})
