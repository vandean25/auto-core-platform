import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Guards the token contract in index.css: `.dark` only swaps variables, so every token must exist in both blocks.
const css = readFileSync(path.resolve(import.meta.dirname, 'index.css'), 'utf8')

const colorTokens = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'info',
  'info-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
]

function cssBlock(pattern: RegExp) {
  const match = css.match(pattern)
  if (!match) throw new Error(`index.css has no block matching ${pattern}`)
  return match[1]
}

const rootBlock = cssBlock(/^:root \{([\s\S]*?)^\}/m)
const darkBlock = cssBlock(/^\.dark \{([\s\S]*?)^\}/m)
const themeBlock = cssBlock(/^@theme inline \{([\s\S]*?)^\}/m)

describe('ACP theme tokens (AUT-655)', () => {
  it.each(colorTokens)('defines --%s in :root and .dark', (token) => {
    expect(rootBlock).toMatch(new RegExp(`^\\s*--${token}:`, 'm'))
    expect(darkBlock).toMatch(new RegExp(`^\\s*--${token}:`, 'm'))
  })

  it.each(colorTokens)('maps --color-%s to its variable in @theme inline', (token) => {
    expect(themeBlock).toContain(`--color-${token}: var(--${token});`)
  })

  it('makes dark variants follow the dark class, not the OS setting', () => {
    expect(css).toContain('@custom-variant dark (&:is(.dark *));')
  })

  it.each([400, 500, 600, 700])('loads Inter %i', (weight) => {
    expect(css).toContain(`@import "@fontsource/inter/${weight}.css";`)
  })
})
