import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { motionDurationClass, motionDurationMs, motionKindOf } from './motion-tokens'

afterEach(cleanup)

// Scenario 1: WHEN a sheet opens THEN its transition uses the 200 ms token (AUT-881 / ADR-0036 R6).
describe('sheet motion token', () => {
  it('opens with the 200 ms overlay transition token', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet</SheetTitle>
        </SheetContent>
      </Sheet>,
    )

    const content = screen.getByRole('dialog')
    expect(content).toHaveClass(motionDurationClass.overlay)
    expect(motionDurationMs.overlay).toBe(200)
    // 200 ms replaced the previous 250/220 ms literals
    expect(content.className).not.toMatch(/duration-(250|220)\b/)
    expect(content).toHaveClass('motion-reduce:animate-none', 'motion-reduce:transition-none')
  })
})

// Scenario 2: WHEN a dropdown or popover opens THEN its transition uses the 150 ms token.
describe('finite UI transition token', () => {
  it.each([
    [
      'dropdown menu',
      <DropdownMenu open key="dropdown">
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
      'menu',
    ],
    [
      'popover',
      <Popover open key="popover">
        <PopoverTrigger>Popover</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>,
      'dialog',
    ],
  ])('%s opens with the 150 ms transition token', (_label, ui, role) => {
    render(ui)

    expect(screen.getByRole(role)).toHaveClass(motionDurationClass.ui)
    expect(motionDurationMs.ui).toBe(150)
  })
})

// Scenario 4: WHEN a functional loading indicator spins THEN it is classified as repeating, not as a finite transition.
describe('motion classification', () => {
  it('classifies the spinner as a repeating functional indicator, exempt from the finite 200 ms cap', () => {
    render(<Spinner />)

    expect(screen.getByRole('status')).toHaveClass('animate-spin', 'motion-reduce:animate-none')
    expect(motionKindOf('spinner')).toBe('repeating')
    expect(motionKindOf('spinner')).not.toBe('finite-transition')
    expect(motionDurationMs.overlay).toBeLessThanOrEqual(200)
  })
})

// Guard for the later duration lint (AUT-893): the exported class names must embed the token values.
describe('exported duration classes', () => {
  it('exports Tailwind class names that a lint can resolve to the token values', () => {
    expect(motionDurationClass.ui).toBe('duration-150')
    expect(motionDurationClass.overlay).toBe('duration-200')
    expect(motionKindOf('saveDebounce')).toBe('non-motion-timing')
    expect(motionKindOf('skeletonDelay')).toBe('non-motion-timing')
    expect(motionKindOf('toastLifetime')).toBe('non-motion-timing')
    expect(motionKindOf('requestTimeout')).toBe('non-motion-timing')
  })
})
