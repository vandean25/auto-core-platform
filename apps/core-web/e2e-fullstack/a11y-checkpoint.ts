import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { A11Y_AXE_TAGS, settleA11yPage } from '../e2e/utils/a11y.ts'
import { compareA11yViolationsToBaseline } from './a11y-baseline.mjs'
import { A11Y_FULLSTACK_CHECKPOINT_PATHS } from './a11y-checkpoint-paths.ts'

const baselinePath = resolve(fileURLToPath(new URL('.', import.meta.url)), 'a11y-baseline.json')

type A11yBaseline = Record<string, Record<string, number>>

function loadBaseline(): A11yBaseline {
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as A11yBaseline
}

export async function scanA11y(page: Page, checkpointId: string): Promise<void> {
  expect(
    Object.prototype.hasOwnProperty.call(A11Y_FULLSTACK_CHECKPOINT_PATHS, checkpointId),
    `[a11y] checkpoint "${checkpointId}" must be registered in e2e-fullstack/a11y-checkpoint-paths.ts`,
  ).toBe(true)

  await settleA11yPage(page)

  const results = await new AxeBuilder({ page }).withTags(A11Y_AXE_TAGS).analyze()
  const pathname = new URL(page.url()).pathname

  await test.info().attach(`a11y-${checkpointId}`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  })

  const comparison = compareA11yViolationsToBaseline({
    checkpointId,
    pathname,
    violations: results.violations,
    baseline: loadBaseline(),
  })

  expect(comparison.ok, comparison.message).toBe(true)
}
