import { test, expect } from '@playwright/test';
import { expectNoCriticalA11yViolations } from './utils/a11y';

test.describe('Login Page', () => {
  test('passes accessibility checks', async ({ page }) => {
    // Intercept firebase.ts to trick AuthProvider into rendering the form
    // without actually calling Firebase APIs
    await page.route('**/src/lib/firebase.ts*', async (route) => {
      const response = await route.fetch();
      let text = await response.text();
      text = text.replace('export const firebaseConfigMissing = !hasFirebaseConfig', 'export const firebaseConfigMissing = false');
      await route.fulfill({ response, body: text });
    });

    // To trick the AuthProvider into NOT using E2E bypass:
    await page.route('**/src/lib/runtime-flags.ts*', async (route) => {
      const response = await route.fetch();
      let text = await response.text();
      text = text.replace('import.meta.env.VITE_E2E_SKIP_AUTH === "true"', 'false');
      text = text.replace("import.meta.env.VITE_E2E_SKIP_AUTH === 'true'", 'false');
      await route.fulfill({ response, body: text });
    });

    // We block real auth network calls
    await page.route('**/identitytoolkit.googleapis.com/**', async (route) => route.abort());

    await page.goto('/login');

    // Wait for the actual sign in form to appear
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await expectNoCriticalA11yViolations(page);
  });
});
