import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { buildActionDialogHref, useActionDialogParam } from './use-action-dialog-param'

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
