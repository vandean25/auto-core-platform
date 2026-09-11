import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageLoader } from './PageLoader'

describe('PageLoader', () => {
  it('uses the application loading copy', () => {
    render(<PageLoader />)

    expect(screen.getByText('Loading Auto Core…')).toBeInTheDocument()
    expect(screen.queryByText('Loading module...')).not.toBeInTheDocument()
  })
})
