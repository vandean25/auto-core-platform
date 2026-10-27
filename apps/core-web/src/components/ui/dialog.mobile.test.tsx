import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './dialog'

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

  it('keeps the title clear of the close button on a phone', () => {
    render(
      <Dialog open>
        <DialogContent fullScreenOnPhone aria-describedby={undefined}>
          <DialogTitle>Long title next to the close button</DialogTitle>
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByText('Long title next to the close button').className).toContain('max-sm:pr-12')
    expect(screen.getByRole('dialog').className).toContain('max-sm:[&>button:first-of-type]:right-2')
  })

  it('keeps DialogHeader outside the scroll region', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Pinned title</DialogTitle>
          </DialogHeader>
          <p>Scrollable body</p>
        </DialogContent>
      </Dialog>,
    )

    const content = screen.getByRole('dialog')
    const body = content.querySelector('.dialog-body')
    const title = screen.getByText('Pinned title')

    expect(body).toBeTruthy()
    expect(body?.contains(title)).toBe(false)
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

  it('keeps header and footer pinned when they are wrapped in a form', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <form onSubmit={(event) => event.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Form dialog</DialogTitle>
            </DialogHeader>
            <p>Fields</p>
            <DialogFooter>
              <button type="submit">Save</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>,
    )

    const content = screen.getByRole('dialog')
    const body = content.querySelector('.dialog-body')
    const title = screen.getByText('Form dialog')
    const save = screen.getByRole('button', { name: 'Save' })

    expect(body?.contains(title)).toBe(false)
    expect(body?.contains(save)).toBe(false)
    expect(content.querySelector('form')).toBeTruthy()
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

  it('fills the screen below sm only when fullScreenOnPhone is set', () => {
    const { rerender } = render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Default</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByRole('dialog').className).not.toContain('max-sm:h-dvh')

    rerender(
      <Dialog open>
        <DialogContent fullScreenOnPhone aria-describedby={undefined}>
          <DialogTitle>Full screen</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const className = screen.getByRole('dialog').className
    expect(className).toContain('max-sm:h-dvh')
    expect(className).toContain('max-sm:w-full')
    expect(className).toContain('max-sm:rounded-none')
    expect(className).toContain('safe-area-inset-bottom')
    expect(className).toContain('sm:w-full')
  })
})
