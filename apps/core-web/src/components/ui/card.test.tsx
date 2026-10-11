import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CardTitle } from './card'

describe('CardTitle', () => {
  it('renders an h2 by default', () => {
    render(<CardTitle>Customer</CardTitle>)

    expect(screen.getByRole('heading', { level: 2, name: 'Customer' })).toBeInTheDocument()
  })

  it('renders the heading level passed as `as` without forwarding the prop to the DOM', () => {
    render(<CardTitle as="h3">Notes</CardTitle>)

    const heading = screen.getByRole('heading', { level: 3, name: 'Notes' })
    expect(heading).toBeInTheDocument()
    expect(heading).not.toHaveAttribute('as')
  })
})
