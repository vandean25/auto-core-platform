import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { measureStartupBundle, ORIGIN_MAIN_STARTUP_BASELINE } from '../scripts/check-startup-bundle'

test.describe('AUT-1025 Scenario 3: startup JS bundle budget', () => {
  test('production startup file count and gzip JS size are smaller than origin/main baseline', () => {
    const distPwaDir = path.resolve(import.meta.dirname, '../dist-pwa')
    const manifestPath = path.join(distPwaDir, '.vite/manifest.json')
    expect(fs.existsSync(manifestPath), `Expected ${manifestPath} to exist (run npm run build:pwa)`).toBe(true)

    const metrics = measureStartupBundle(distPwaDir)
    expect(metrics.startupFiles).toBeLessThan(ORIGIN_MAIN_STARTUP_BASELINE.startupFiles)
    expect(metrics.startupGzipBytes).toBeLessThan(ORIGIN_MAIN_STARTUP_BASELINE.startupGzipBytes)
    expect(metrics.entryGzipBytes).toBeLessThan(ORIGIN_MAIN_STARTUP_BASELINE.entryGzipBytes)
  })
})
