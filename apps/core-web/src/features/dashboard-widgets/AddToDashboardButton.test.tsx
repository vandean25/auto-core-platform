import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { DASHBOARD_WIDGET_SOURCE_CUSTOMERS } from '@/features/dashboard-widgets/sources'
import { AddToDashboardButton } from './AddToDashboardButton'

const TRIGGER_NAME = 'Zum Dashboard hinzufügen'
const TOOLTIP = 'Dieses Ergebnis als Widget auf Ihrem Dashboard anzeigen'

function renderAddButton() {
  return render(
    <MemoryRouter initialEntries={['/customers?search=klaus']}>
      <DashboardWidgetsProvider userKey="test-user">
        <AddToDashboardButton source={DASHBOARD_WIDGET_SOURCE_CUSTOMERS} />
      </DashboardWidgetsProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('AddToDashboardButton', () => {
  it('names the trigger "Add to dashboard" and no longer "Add to Dashboard"', () => {
    renderAddButton()

    expect(screen.getByRole('button', { name: TRIGGER_NAME })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to Dashboard' })).not.toBeInTheDocument()
  })

  it('shows its one-line tooltip when the trigger receives keyboard focus', async () => {
    renderAddButton()

    act(() => screen.getByRole('button', { name: TRIGGER_NAME }).focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(TOOLTIP)
  })

  it('shows its one-line tooltip on hover', async () => {
    renderAddButton()

    fireEvent.pointerMove(screen.getByRole('button', { name: TRIGGER_NAME }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(TOOLTIP)
  })

  it('dismisses the tooltip when Escape is pressed', async () => {
    renderAddButton()
    const trigger = screen.getByRole('button', { name: TRIGGER_NAME })
    act(() => trigger.focus())
    await screen.findByRole('tooltip')

    fireEvent.keyDown(trigger, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('still opens the widget dialog from the renamed trigger', async () => {
    renderAddButton()

    fireEvent.click(screen.getByRole('button', { name: TRIGGER_NAME }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Widget zum Dashboard hinzufügen' })).toBeInTheDocument()
  })
})
