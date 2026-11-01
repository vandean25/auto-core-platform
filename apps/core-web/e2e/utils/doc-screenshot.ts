import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const DOC_ASSETS_DIR = fileURLToPath(new URL('../../../../docs/internal/assets/', import.meta.url))

/**
 * Captures a page screenshot for the docs. Plain e2e runs (local and CI) skip it, so a test run
 * never rewrites files under docs/; re-capture the committed images on purpose with
 * `UPDATE_DOC_SCREENSHOTS=1 npm run test:e2e -- e2e/<spec>.spec.ts`.
 */
export async function captureDocScreenshot(page: Page, fileName: string, options: { fullPage?: boolean } = {}) {
  if (process.env.UPDATE_DOC_SCREENSHOTS !== '1') return
  await mkdir(DOC_ASSETS_DIR, { recursive: true })
  await page.screenshot({ ...options, path: join(DOC_ASSETS_DIR, fileName) })
}
