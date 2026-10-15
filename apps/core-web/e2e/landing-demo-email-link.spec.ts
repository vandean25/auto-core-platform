import { test, expect } from '@playwright/test'

test.describe('Landing demo email-link completion (smoke)', () => {
  test('shows the German completion UI for magic-link URLs', async ({ page }) => {
    await page.route('**/src/lib/firebase.ts*', async (route) => {
      const response = await route.fetch()
      let text = await response.text()
      text = text.replace(
        'export const firebaseConfigMissing = !hasFirebaseConfig',
        'export const firebaseConfigMissing = false',
      )
      await route.fulfill({ response, body: text })
    })

    await page.route('**/src/lib/runtime-flags.ts*', async (route) => {
      const response = await route.fetch()
      let text = await response.text()
      text = text.replace('import.meta.env.VITE_E2E_SKIP_AUTH === "true"', 'false')
      text = text.replace("import.meta.env.VITE_E2E_SKIP_AUTH === 'true'", 'false')
      await route.fulfill({ response, body: text })
    })

    await page.route('**/src/auth/landing-demo-email-link.ts*', async (route) => {
      const response = await route.fetch()
      let text = await response.text()
      text = text.replace(
        'return isSignInWithEmailLink(firebaseAuth, href)',
        'return href.includes("oobCode=")',
      )
      await route.fulfill({ response, body: text })
    })

    await page.route('**/identitytoolkit.googleapis.com/**', async (route) => route.abort())

    await page.goto('/login?apiKey=test&oobCode=demo-oob-code&mode=signIn')

    await expect(page.getByRole('heading', { name: 'Demo-Anmeldung' })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByLabel('E-Mail')).toBeVisible()
  })
})
