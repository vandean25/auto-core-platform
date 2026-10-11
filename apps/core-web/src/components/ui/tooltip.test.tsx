import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipHint } from './tooltip'

afterEach(() => {
  cleanup()
})

function renderTooltip() {
  return render(
    <TooltipHint hint="One-line help">
      <button type="button">Trigger</button>
    </TooltipHint>,
  )
}

describe('Tooltip', () => {
  it('opens on keyboard focus and describes the trigger while open', async () => {
    renderTooltip()
    const trigger = screen.getByRole('button', { name: 'Trigger' })

    act(() => trigger.focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent('One-line help')
    expect(trigger).toHaveAccessibleDescription('One-line help')
  })

  it('closes when Escape is pressed', async () => {
    renderTooltip()
    const trigger = screen.getByRole('button', { name: 'Trigger' })
    act(() => trigger.focus())
    await screen.findByRole('tooltip')

    fireEvent.keyDown(trigger, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })
})
