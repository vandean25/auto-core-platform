import { expect, type Page } from '@playwright/test'

import { DE_COMMON } from './de-common'

export async function expectListPeekForRecord(
  page: Page,
  recordId: string,
  sheetHeading: string | RegExp,
) {
  await expect(page).toHaveURL(new RegExp(`[?&]peek=${recordId}(?:&|$)`))
  const sheet = page.getByTestId('entity-peek-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: sheetHeading })).toBeVisible()
}

export async function closeListPeekSheet(page: Page) {
  const sheet = page.getByTestId('entity-peek-sheet')
  await sheet.getByRole('button', { name: DE_COMMON.actions.close }).click()
  await expect(sheet).not.toBeVisible()
  await expect(page).not.toHaveURL(/[?&]peek=/)
}

export async function openListPeekInFull(page: Page) {
  const sheet = page.getByTestId('entity-peek-sheet')
  await sheet.getByRole('link', { name: DE_COMMON.peek.openInFull }).click()
}
