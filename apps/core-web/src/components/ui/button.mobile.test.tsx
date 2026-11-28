import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from './button'

afterEach(cleanup)

describe('Button mobile touch targets', () => {
  it.each(['default', 'sm'] as const)(
    'applies max-sm:min-h-11 while keeping desktop height for size=%s',
    (size) => {
      render(<Button size={size}>Action</Button>)
      const button = screen.getByRole('button', { name: 'Action' })
      expect(button).toHaveClass('max-sm:min-h-11')
      expect(button).toHaveClass(size === 'sm' ? 'h-8' : 'h-9')
    },
  )

  it('applies max-sm:min-h-11 and max-sm:min-w-11 for size=icon while keeping h-9 w-9', () => {
    render(
      <Button size="icon" aria-label="Edit">
        <span>E</span>
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Edit' })
    expect(button).toHaveClass('max-sm:min-h-11', 'max-sm:min-w-11', 'h-9', 'w-9')
  })

  it('keeps size=lg and size=link unchanged', () => {
    render(
      <>
        <Button size="lg">Large</Button>
        <Button variant="link" size="lg">
          Link
        </Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass('h-10')
    expect(screen.getByRole('button', { name: 'Large' })).not.toHaveClass('max-sm:min-h-11')
  })

  it('allows dense desktop-only opt-out via max-sm:min-h-0 and max-sm:min-w-0', () => {
    render(
      <>
        <Button size="sm" className="max-sm:min-h-0">
          Dense sm
        </Button>
        <Button size="icon" className="max-sm:min-h-0 max-sm:min-w-0" aria-label="Dense icon">
          <span>D</span>
        </Button>
      </>,
    )
    const denseSm = screen.getByRole('button', { name: 'Dense sm' })
    expect(denseSm).toHaveClass('h-8', 'max-sm:min-h-0')
    expect(denseSm).not.toHaveClass('max-sm:min-h-11')

    const denseIcon = screen.getByRole('button', { name: 'Dense icon' })
    expect(denseIcon).toHaveClass('h-9', 'w-9', 'max-sm:min-h-0', 'max-sm:min-w-0')
    expect(denseIcon).not.toHaveClass('max-sm:min-h-11')
    expect(denseIcon).not.toHaveClass('max-sm:min-w-11')

    expect(
      cn(buttonVariants({ size: 'default' }), 'max-sm:min-h-0'),
    ).not.toContain('max-sm:min-h-11')
  })
})
