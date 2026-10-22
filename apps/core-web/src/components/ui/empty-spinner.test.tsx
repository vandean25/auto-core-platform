import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import deCommon from '../../../../../locales/de/common.json'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from './empty'
import { Spinner } from './spinner'

afterEach(cleanup)

describe('Empty and Spinner', () => {
  it('Empty renders title, description and an action', () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Noch keine Kunden</EmptyTitle>
          <EmptyDescription>Legen Sie den ersten Kunden an.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <button type="button">Kunde</button>
        </EmptyContent>
      </Empty>,
    )

    expect(screen.getByText('Noch keine Kunden')).toBeInTheDocument()
    expect(screen.getByText('Legen Sie den ersten Kunden an.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kunde' })).toBeInTheDocument()
  })

  it('Spinner has a localized status name and honors reduced motion', () => {
    render(<Spinner />)

    const spinner = screen.getByRole('status', { name: deCommon.shell.loading })
    expect(spinner).toHaveClass('animate-spin', 'motion-reduce:animate-none')
  })
})
