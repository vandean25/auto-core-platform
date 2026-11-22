import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { measureStartupBundle, ORIGIN_MAIN_STARTUP_BASELINE } from './check-startup-bundle'

describe('check-startup-bundle', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('walks entry chunk static imports and CSS assets from Vite manifest.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-bundle-'))
    tempDirs.push(dir)
    fs.mkdirSync(path.join(dir, '.vite'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })

    fs.writeFileSync(path.join(dir, 'assets/index.js'), 'console.log("entry")')
    fs.writeFileSync(path.join(dir, 'assets/vendor.js'), 'export const x = 1')
    fs.writeFileSync(path.join(dir, 'assets/index.css'), 'body{}')
    fs.writeFileSync(path.join(dir, 'assets/lazy.js'), 'export const lazy = 1')

    fs.writeFileSync(
      path.join(dir, '.vite/manifest.json'),
      JSON.stringify({
        'src/main.tsx': {
          file: 'assets/index.js',
          isEntry: true,
          imports: ['_vendor.js'],
          dynamicImports: ['src/LazyPage.tsx'],
          css: ['assets/index.css'],
        },
        '_vendor.js': { file: 'assets/vendor.js' },
        'src/LazyPage.tsx': { file: 'assets/lazy.js', isDynamicEntry: true },
      }),
    )

    const metrics = measureStartupBundle(dir)
    expect(metrics.startupFiles).toBe(4) // index.html + index.js + vendor.js + index.css
    expect(metrics.startupAssetFiles).toBe(3)
    expect(metrics.entryFile).toBe('assets/index.js')
    expect(metrics.startupRawBytes).toBe(
      'console.log("entry")'.length + 'export const x = 1'.length + 'body{}'.length,
    )
  })

  it('verifies built production bundle is smaller than origin/main baseline when dist exists', () => {
    const distDir = path.resolve(import.meta.dirname, '../dist')
    if (!fs.existsSync(path.join(distDir, '.vite/manifest.json'))) {
      return
    }
    const metrics = measureStartupBundle(distDir)
    expect(metrics.startupFiles).toBeLessThan(ORIGIN_MAIN_STARTUP_BASELINE.startupFiles)
    expect(metrics.startupGzipBytes).toBeLessThan(ORIGIN_MAIN_STARTUP_BASELINE.startupGzipBytes)
    expect(metrics.entryGzipBytes).toBeLessThan(ORIGIN_MAIN_STARTUP_BASELINE.entryGzipBytes)
  })
})
