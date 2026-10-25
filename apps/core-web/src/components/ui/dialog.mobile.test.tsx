import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from './dialog'

afterEach(cleanup)

describe('DialogContent mobile foundations', () => {
  it('constrains height and scrolls on small viewports', () => {
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
    expect(content.className).toContain('overflow-y-auto')
    expect(content.className).toContain('w-[calc(100%-1rem)]')
    expect(content.className).toContain('sm:w-full')
  })
})
