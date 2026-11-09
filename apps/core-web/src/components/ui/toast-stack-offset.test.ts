import { describe, expect, it } from 'vitest'

import { TOAST_STACK_OFFSET_DESKTOP, TOAST_STACK_OFFSET_MOBILE } from './toast-stack-offset'

describe('toast stack offset (AUT-919)', () => {
  it('includes phone nav and sticky bottom chrome in mobile and desktop offsets', () => {
    for (const offset of [TOAST_STACK_OFFSET_DESKTOP, TOAST_STACK_OFFSET_MOBILE]) {
      expect(offset).toContain('var(--phone-nav-h)')
      expect(offset).toContain('var(--sticky-bottom-chrome-h)')
    }
  })
})
