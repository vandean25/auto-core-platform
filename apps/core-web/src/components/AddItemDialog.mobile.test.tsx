// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(import.meta.dirname, 'AddItemDialog.tsx'),
  'utf8',
)

describe('AddItemDialog mobile layout', () => {
  it('uses min-w-0 and single-column grids on narrow viewports', () => {
    expect(source).toContain('min-w-0')
    expect(source).toContain('grid-cols-1')
    expect(source).toContain('sm:grid-cols-2')
  })
})
