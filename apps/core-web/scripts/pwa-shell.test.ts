// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(webRoot, '../..')

type HeaderRule = { source: string; headers: { key: string; value: string }[] }
type Hosting = { headers: HeaderRule[]; rewrites: { source?: string; regex?: string; destination?: string }[] }
const hosting = (JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8')) as { hosting: Hosting }).hosting

const headersOf = (source: string) => hosting.headers.find((rule) => rule.source === source)?.headers ?? []
const headerValue = (source: string, key: string) => headersOf(source).find((header) => header.key === key)?.value

describe('firebase.json hosting for the PWA shell', () => {
  it.each(['/sw.js', '/manifest.webmanifest', '/offline.html'])('serves %s with Cache-Control no-cache', (source) => {
    expect(headerValue(source, 'Cache-Control')).toBe('no-cache')
  })

  it('serves the manifest as application/manifest+json', () => {
    expect(headerValue('/manifest.webmanifest', 'Content-Type')).toBe('application/manifest+json')
  })

  it('keeps hashed assets immutable and the existing no-cache entries', () => {
    expect(headerValue('/assets/**', 'Cache-Control')).toBe('public,max-age=31536000,immutable')
    for (const source of ['/index.html', '/', '/version.json']) {
      expect(headerValue(source, 'Cache-Control')).toBe('no-cache')
    }
  })

  it('does not widen the worker scope with a Service-Worker-Allowed header', () => {
    const keys = hosting.headers.flatMap((rule) => rule.headers.map((header) => header.key.toLowerCase()))
    expect(keys).not.toContain('service-worker-allowed')
  })

  it('answers a missing /sw.js (and other files with an extension) with 404, not with index.html', () => {
    const spaRewrite = hosting.rewrites.find((rewrite) => rewrite.destination === '/index.html')
    expect(spaRewrite?.regex).toBeDefined()
    const rewritten = (path: string) => new RegExp(spaRewrite!.regex!).test(path)

    expect(rewritten('/sw.js')).toBe(false)
    expect(rewritten('/manifest.webmanifest')).toBe(false)
    expect(rewritten('/offline.html')).toBe(false)
    expect(rewritten('/icons/icon-192.png')).toBe(false)
    // App routes still fall back to the SPA.
    expect(rewritten('/')).toBe(true)
    expect(rewritten('/customers')).toBe(true)
    expect(rewritten('/mechanic/tasks/123')).toBe(true)
  })
})

function pngSize(file: string) {
  const bytes = readFileSync(file)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

describe('web app manifest and icons', () => {
  const manifest = JSON.parse(readFileSync(join(webRoot, 'public/manifest.webmanifest'), 'utf8')) as {
    id: string
    name: string
    short_name: string
    lang: string
    start_url: string
    scope: string
    display: string
    theme_color: string
    background_color: string
    icons: { src: string; sizes: string; type: string; purpose: string }[]
  }

  it('describes an installable standalone app', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Auto Core',
      short_name: 'Auto Core',
      lang: 'de',
      start_url: '/?source=pwa',
      scope: '/',
      display: 'standalone',
    })
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('lists 192 and 512 icons (any) and a 512 maskable icon whose files exist at the stated size', () => {
    const find = (purpose: string, sizes: string) => manifest.icons.find((icon) => icon.purpose === purpose && icon.sizes === sizes)
    for (const icon of [find('any', '192x192'), find('any', '512x512'), find('maskable', '512x512')]) {
      expect(icon, 'icon entry').toBeDefined()
      expect(icon!.type).toBe('image/png')
      expect(icon!.src).not.toMatch(/^\/assets\//)
      expect(pngSize(join(webRoot, 'public', icon!.src))).toBe(icon!.sizes)
    }
  })

  it('has the apple touch icon (180) and links manifest, icons and theme in index.html', () => {
    expect(pngSize(join(webRoot, 'public/icons/apple-touch-icon.png'))).toBe('180x180')
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />')
    expect(html).toContain('<meta name="theme-color" content="#ffffff" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Auto Core" />')
    expect(html).toContain('viewport-fit=cover')
    expect(html).not.toContain('vite.svg')
    expect(existsSync(join(webRoot, 'public/vite.svg'))).toBe(false)
  })

  it('has an offline page that needs nothing but itself and the cached icon', () => {
    const html = readFileSync(join(webRoot, 'public/offline.html'), 'utf8')
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<script\s+src=|<link\s+rel="stylesheet"|@import/)
    expect([...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((match) => match[1])).toEqual(['/icons/icon-192.png'])
  })
})

describe('production build output', () => {
  it('emits sw.js, the manifest and offline.html at the dist root, never under /assets', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'core-web-pwa-build-'))
    const viteBin = resolve(repoRoot, 'node_modules/vite/bin/vite.js')

    try {
      const build = spawnSync(process.execPath, [viteBin, 'build', '--mode', 'production', '--outDir', outDir, '--emptyOutDir'], {
        cwd: webRoot,
        env: { ...process.env, VITE_APP_VERSION: 'v9.9.9-pwa', VITE_E2E_TEST_TOKEN: '', VITE_E2E_SKIP_AUTH: '', PWA_KILL_SWITCH: '' },
        stdio: 'pipe',
      })
      expect(build.status, `${build.stderr}${build.stdout}`).toBe(0)

      const root = readdirSync(outDir)
      for (const file of ['sw.js', 'manifest.webmanifest', 'offline.html', 'version.json', 'favicon.svg', 'index.html']) {
        expect(root).toContain(file)
      }
      expect(readdirSync(join(outDir, 'icons')).sort()).toEqual([
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
      ])
      expect(readdirSync(join(outDir, 'assets')).filter((name) => /^(sw|manifest|offline)/.test(name))).toEqual([])

      // The emitted worker carries the release in its cache name and is a plain script that starts.
      const worker = readFileSync(join(outDir, 'sw.js'), 'utf8')
      expect(worker).toContain('"v9.9.9-pwa"')
      const listeners: string[] = []
      new Function('self', worker)({ addEventListener: (type: string) => listeners.push(type) })
      expect(listeners.sort()).toEqual(['activate', 'fetch', 'install'])
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 180_000)

  it('emits the self-removing worker instead when PWA_KILL_SWITCH is true', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'core-web-pwa-kill-'))
    const viteBin = resolve(repoRoot, 'node_modules/vite/bin/vite.js')

    try {
      const build = spawnSync(process.execPath, [viteBin, 'build', '--mode', 'production', '--outDir', outDir, '--emptyOutDir'], {
        cwd: webRoot,
        env: { ...process.env, VITE_APP_VERSION: 'v9.9.9-pwa', VITE_E2E_TEST_TOKEN: '', VITE_E2E_SKIP_AUTH: '', PWA_KILL_SWITCH: 'true' },
        stdio: 'pipe',
      })
      expect(build.status, `${build.stderr}${build.stdout}`).toBe(0)

      const worker = readFileSync(join(outDir, 'sw.js'), 'utf8')
      expect(worker).toContain('unregister')
      expect(worker).not.toContain('offline.html')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 180_000)
})
