import { test, expect } from '@playwright/test';
import { expectNoCriticalA11yViolations } from './utils/a11y';

// Testing the actual login form rendering by manipulating the auth context before page load.
// We intercept config to allow form to render.
// We intercept firebase and auth calls.

test.describe('Login Page', () => {
  test('passes accessibility checks', async ({ page }) => {
    // Intercept config endpoint to force isConfigured true
    await page.route('**/api/config/auth', async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ isConfigured: true }) });
    });

    // To trick the AuthProvider into NOT using E2E bypass:
    // We rewrite the VITE_E2E_SKIP_AUTH variable in the runtime flags module.
    // In Vite dev server, this is served as a transformed JS module.
    // It's requested from `/src/lib/runtime-flags.ts*`
    await page.route('**/src/lib/runtime-flags.ts*', async (route) => {
      const response = await route.fetch();
      let text = await response.text();
      text = text.replace('import.meta.env.VITE_E2E_SKIP_AUTH === "true"', 'false');
      text = text.replace("import.meta.env.VITE_E2E_SKIP_AUTH === 'true'", 'false');
      await route.fulfill({ response, body: text });
    });

    // We block real auth network calls
    await page.route('**/identitytoolkit.googleapis.com/**', async (route) => route.abort());

    // Because the component uses Navigate inside LoginRoute when `user` is present,
    // if bypass is disabled, user is initially null. So LoginRoute should render the form!
    await page.goto('/login');

    // Wait for the sign in form
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 10000 });

    await expectNoCriticalA11yViolations(page);
  });
});
