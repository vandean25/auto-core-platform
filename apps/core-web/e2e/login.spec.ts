import { test } from '@playwright/test';
import { expectNoCriticalA11yViolations } from './utils/a11y';
import { AutoCorePage } from './pom/AutoCorePage';

test.describe('Login Page', () => {
  test('passes accessibility checks', async ({ page }) => {
    // VITE_E2E_SKIP_AUTH doesn't remove the route, but auto-redirects if we are authenticated.
    // Use an isolated browser context or just let AutoCorePage resolve the routing.
    const corePage = new AutoCorePage(page, 'Login');
    await corePage.navigate('/login');
    await expectNoCriticalA11yViolations(page);
  });
});
