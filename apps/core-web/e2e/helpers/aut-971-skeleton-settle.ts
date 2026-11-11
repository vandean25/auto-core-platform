import { expect, type Page } from '@playwright/test'

import { AutoCorePage } from '../pom/AutoCorePage'

export const AUT_971_LIST_API_DELAY_MS = 280
export const AUT_971_DISMISS_BUDGET_MS = 350

export async function routeWithSettledAt(
  page: Page,
  apiPath: string,
  body: unknown,
  delayMs = AUT_971_LIST_API_DELAY_MS,
) {
  const settledAt = { ms: 0 }
  await page.route(AutoCorePage.apiRouteMatcher(apiPath), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    settledAt.ms = Date.now()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  return settledAt
}

export async function expectSkeletonDismissedBySettleDeadline(
  page: Page,
  settledAt: { ms: number },
  options: {
    apiDelayMs?: number
    dismissBudgetMs?: number
    scope?: 'page' | 'tbody'
  } = {},
) {
  const apiDelayMs = options.apiDelayMs ?? AUT_971_LIST_API_DELAY_MS
  const dismissBudgetMs = options.dismissBudgetMs ?? AUT_971_DISMISS_BUDGET_MS
  const pulseLocator =
    options.scope === 'tbody' ? page.locator('tbody .animate-pulse') : page.locator('.animate-pulse')

  await expect.poll(() => settledAt.ms > 0, { timeout: apiDelayMs + 2_000, intervals: [50] }).toBe(true)
  const deadline = settledAt.ms + dismissBudgetMs
  await expect
    .poll(
      async () => {
        const pulseCount = await pulseLocator.count()
        if (pulseCount === 0) return true
        if (Date.now() > deadline) {
          throw new Error(
            `skeleton pulse count ${pulseCount} still visible ${Date.now() - settledAt.ms}ms after API settle`,
          )
        }
        return false
      },
      { timeout: apiDelayMs + 2_000, intervals: [15, 30, 50] },
    )
    .toBe(true)
}
