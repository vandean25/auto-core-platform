// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = join(import.meta.dirname, '..')

describe('mobile shell foundations', () => {
  it('enables viewport-fit=cover', () => {
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8')
    expect(html).toContain('viewport-fit=cover')
  })

  it('uses additive safe-area inset utilities', () => {
    const css = readFileSync(join(webRoot, 'src/index.css'), 'utf8')
    expect(css).toContain('.safe-area-inset-bottom')
    expect(css).toContain('env(safe-area-inset-bottom')
  })

  it('keeps shell header padding when safe-area insets are zero', () => {
    const appSource = readFileSync(join(webRoot, 'src/App.tsx'), 'utf8')
    expect(appSource).toContain('max(1rem,env(safe-area-inset-left')
    expect(appSource).toContain('min-h-12')
    expect(appSource).not.toContain('safe-area-x')
  })

  it('exposes hover-capable variant for touch-visible actions', () => {
    const css = readFileSync(join(webRoot, 'src/index.css'), 'utf8')
    expect(css).toContain('@custom-variant hover-capable')
  })
})
