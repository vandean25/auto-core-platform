import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GlossaryTerm } from './GlossaryTerm'

afterEach(cleanup)

describe('GlossaryTerm', () => {
  it('exposes a keyboard-focusable trigger with the DE glossary description', async () => {
    render(<GlossaryTerm term="atp" />)

    const trigger = screen.getByTestId('glossary-term-atp')
    expect(trigger).toHaveTextContent('ATP')
    trigger.focus()
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
