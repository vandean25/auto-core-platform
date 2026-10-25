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

  it('defines safe-area utility classes', () => {
    const css = readFileSync(join(webRoot, 'src/index.css'), 'utf8')
    expect(css).toContain('.safe-area-top')
    expect(css).toContain('env(safe-area-inset-top')
    expect(css).toContain('.safe-area-bottom')
  })

  it('exposes hover-capable variant for touch-visible actions', () => {
    const css = readFileSync(join(webRoot, 'src/index.css'), 'utf8')
    expect(css).toContain('@custom-variant hover-capable')
  })
})
