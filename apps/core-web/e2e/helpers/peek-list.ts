import { expect, type Page } from '@playwright/test'

import { DE_COMMON } from './de-common'

export async function expectListPeekForRecord(
  page: Page,
  recordId: string,
  sheetContent: string | RegExp,
) {
  await expect(page).toHaveURL(new RegExp(`[?&]peek=${recordId}(?:&|$)`))
  const sheet = page.getByTestId('entity-peek-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(sheetContent)).toBeVisible()
}

export async function openListPeekInFull(page: Page) {
  const sheet = page.getByTestId('entity-peek-sheet')
  await sheet.getByRole('link', { name: DE_COMMON.peek.openInFull }).click()
}
