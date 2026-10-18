import { expect, type Page } from '@playwright/test'

type AuthSessionResponse = {
  activeTenant: { name: string }
}

/** Waits for `/api/auth/me` and for the active tenant name to appear in the shell. */
export async function gotoWithReadySession(page: Page, path: string) {
  const authMe = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/me') &&
      response.request().method() === 'GET',
  )
  await page.goto(path)
  const response = await authMe
  expect(response.ok()).toBeTruthy()
  const session = (await response.json()) as AuthSessionResponse
  await expect(page.getByText(session.activeTenant.name)).toBeVisible()
  return session
}

/** Overrides the Authorization header for browser API calls (full-stack test-token seam). */
export async function useApiBearerToken(page: Page, token: string) {
  await page.route('**/api/**', async (route) => {
    const headers = {
      ...route.request().headers(),
      authorization: `Bearer ${token}`,
    }
    await route.continue({ headers })
  })
}
