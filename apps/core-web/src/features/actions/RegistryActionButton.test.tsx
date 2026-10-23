import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { EntityActionConfirmHost } from './action-confirm-host'
import type { EntityActionDefinition } from './entity-action'
import { RegistryActionButton } from './RegistryActionButton'

type Item = { id: string; enabled: boolean }

describe('RegistryActionButton', () => {
  afterEach(cleanup)

  it('renders a button with data-action-id when allowed and enabled', () => {
    const run = vi.fn()
    const action: EntityActionDefinition<Item, { tag: string }> = {
      id: 'workOrder.jobCardPdf',
      kind: 'run',
      label: 'Arbeitskarte drucken',
      isAllowedForRole: (role) => role === 'ADMIN',
      isEnabled: (item) => item.enabled,
      run,
    }

    const adminRole = 'ADMIN'
    const techRole = 'TECH'
    const { rerender } = render(
      <RegistryActionButton
        action={action}
        role={adminRole}
        record={{ id: 'wo-1', enabled: true }}
        runContext={{ tag: 'ctx' }}
      />,
    )

    const button = screen.getByRole('button', { name: 'Arbeitskarte drucken' })
    expect(button).toHaveAttribute('data-action-id', 'workOrder.jobCardPdf')
    fireEvent.click(button)
    expect(run).toHaveBeenCalledWith({ id: 'wo-1', enabled: true }, { tag: 'ctx' })

    rerender(
      <RegistryActionButton
        action={action}
        role={techRole}
        record={{ id: 'wo-1', enabled: true }}
        runContext={{ tag: 'ctx' }}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(
      <RegistryActionButton
        action={action}
        role={adminRole}
        record={{ id: 'wo-1', enabled: false }}
        runContext={{ tag: 'ctx' }}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('routes destructive button clicks through the shared confirm host', () => {
    const adminRole = 'ADMIN'
    const run = vi.fn()
    const action: EntityActionDefinition<Item, Record<string, never>> = {
      id: 'customer.delete',
      kind: 'run',
      label: 'Löschen',
      destructive: true,
      confirm: {
        title: 'Kunde löschen',
        description: 'Diesen Kunden wirklich löschen?',
      },
      isAllowedForRole: () => true,
      isEnabled: () => true,
      run,
    }

    render(
      <>
        <RegistryActionButton
          action={action}
          role={adminRole}
          record={{ id: 'cust-1', enabled: true }}
          runContext={{}}
        />
        <EntityActionConfirmHost />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }))
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Diesen Kunden wirklich löschen?')

    fireEvent.click(screen.getByRole('button', { name: deCommon.actions.confirm }))
    expect(run).toHaveBeenCalledTimes(1)
  })
})
