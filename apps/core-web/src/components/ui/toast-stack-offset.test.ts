import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { TOAST_STACK_OFFSET_DESKTOP, TOAST_STACK_OFFSET_MOBILE } from './toast-stack-offset'

const indexCss = readFileSync(path.resolve(import.meta.dirname, '../../index.css'), 'utf8')

describe('toast stack offset (AUT-919)', () => {
  it('includes phone nav and sticky bottom chrome in mobile and desktop offsets', () => {
    for (const offset of [TOAST_STACK_OFFSET_DESKTOP, TOAST_STACK_OFFSET_MOBILE]) {
      expect(offset).toContain('var(--phone-nav-h)')
      expect(offset).toContain('var(--sticky-bottom-chrome-h)')
      expect(offset).toContain('var(--sticky-bottom-chrome-floor, 0px)')
    }
  })

  it('defines a sticky chrome floor while checkout footer is on screen (mobile and desktop, AUT-948)', () => {
    expect(indexCss).toMatch(
      /:root:has\(\[data-sticky-bottom-chrome\]\)\s*\{[^}]*--sticky-bottom-chrome-floor:\s*7rem/,
    )
  })
})
