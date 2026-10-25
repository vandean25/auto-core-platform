import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './dialog'

afterEach(cleanup)

describe('DialogContent mobile foundations', () => {
  it('uses default max-w-lg that callers can override via tailwind-merge', () => {
    const merged = cn(
      'fixed max-w-lg sm:w-full',
      'max-w-3xl',
    )
    expect(merged).toContain('max-w-3xl')
    expect(merged).not.toContain('max-w-lg')
  })

  it('keeps the shell fixed height with an inner scroll region', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Long dialog</DialogTitle>
          <p>Scrollable body</p>
        </DialogContent>
      </Dialog>,
    )

    const content = screen.getByRole('dialog')
    expect(content.className).toContain('max-h-[90dvh]')
    expect(content.className).toContain('overflow-hidden')
    expect(content.className).not.toContain('overflow-y-auto')
    expect(content.className).toContain('w-[calc(100%-1rem)]')
    expect(content.className).toContain('sm:w-full')
    expect(content.className).toContain('max-w-lg')
    expect(content.className).not.toContain('sm:max-w-lg')

    const body = content.querySelector('.dialog-body')
    expect(body).toBeTruthy()
    expect(body?.className).toContain('overflow-y-auto')
  })

  it('keeps DialogFooter outside the scroll region', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>With footer</DialogTitle>
          <p>Body copy</p>
          <DialogFooter>
            <button type="button">Confirm</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    const content = screen.getByRole('dialog')
    const body = content.querySelector('.dialog-body')
    const footer = screen.getByRole('button', { name: 'Confirm' }).closest('[class*="shrink-0"]')

    expect(body).toBeTruthy()
    expect(footer).toBeTruthy()
    expect(within(content).getByRole('button', { name: 'Confirm' })).not.toEqual(
      body?.querySelector('button'),
    )
  })

  it('preserves a caller-provided wide max width class', () => {
    render(
      <Dialog open>
        <DialogContent className="max-w-3xl" aria-describedby={undefined}>
          <DialogTitle>Wide</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByRole('dialog').className).toContain('max-w-3xl')
  })
})
