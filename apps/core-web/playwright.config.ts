import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI
/* Optional local override for agent VMs whose preinstalled Chromium differs from @playwright/test. Unset in CI. */
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: isCI,
  /* Retry once on CI. A test that only passes on the retry is reported as flaky and must be fixed. */
  retries: isCI ? 1 : 0,
  /* Each CI shard runs on its own 2-vCPU runner, so run two browsers per shard. */
  workers: isCI ? 2 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:5174',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // login.spec.ts and landing-demo-email-link.spec.ts rewrite dev-server modules; they run on the dev server below.
      testIgnore: /login\.spec\.ts$|landing-demo-email-link\.spec\.ts$|i18n-en-login\.spec\.ts$/,
    },
    {
      name: 'chromium-dev-server',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5175' },
      testMatch: /login\.spec\.ts$|landing-demo-email-link\.spec\.ts$|i18n-en-login\.spec\.ts$/,
    },
  ],

  /* Serve the production bundle that `npm run build:e2e` writes (`npm run test:e2e` builds it first). */
  webServer: [
    {
      command: 'vite preview --outDir dist-e2e --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: !isCI,
      cwd: './',
    },
    {
      command:
        'cross-env VITE_E2E_SKIP_AUTH=true VITE_FEATURE_AGENT_SUPERVISION=true VITE_APP_VERSION=v1.0.0-e2e vite --port 5175 --strictPort',
      url: 'http://localhost:5175',
      reuseExistingServer: !isCI,
      cwd: './',
    },
  ],
});
