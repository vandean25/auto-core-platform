import { expect, test, type Page } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_SHELL } from './helpers/de-shell'
import { expectNoPageScroll } from './utils/phone-layout'

/**
 * AUT-659: the theme switch in the account menu (Hell / Dunkel / System). The choice is stored in
 * localStorage (`acp-theme`) and puts the class `dark` on <html>; print views stay light.
 */
const jsonResponse = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** Perceived brightness (0 black, 1 white) of the page background as the browser paints it. */
async function backgroundBrightness(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.fillStyle = getComputedStyle(document.body).backgroundColor
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  })
}

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click()
  await expect(page.getByTestId('theme-option-dark')).toBeVisible()
}

async function open(page: Page, path = '/dashboard') {
  await new AutoCorePage(page, 'Dark mode').navigate(path)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
}

test.describe('Dark mode switch (AUT-659)', () => {
  test('WHEN the user picks Dunkel in the account menu THEN <html> gets the class dark and the page uses dark tokens', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page)
    expect(await backgroundBrightness(page)).toBeGreaterThan(0.9)

    await openAccountMenu(page)
    await page.getByTestId('theme-option-dark').click()

    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    expect(await backgroundBrightness(page)).toBeLessThan(0.2)
  })

  test('WHEN the page is reloaded THEN the chosen theme is kept (localStorage)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page)
    await openAccountMenu(page)
    await page.getByTestId('theme-option-dark').click()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    expect(await page.evaluate(() => window.localStorage.getItem('acp-theme'))).toBe('dark')

    await page.reload()
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()

    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await openAccountMenu(page)
    await expect(page.getByTestId('theme-option-dark')).toBeChecked()
  })

  test('WHEN System is chosen THEN the theme follows prefers-color-scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page)
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)

    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  })

  test('WHEN a print view is opened in dark mode THEN it stays light', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('acp-theme', 'dark'))
    await page.route(AutoCorePage.apiRouteMatcher('/api/workshop/loaner-bookings/booking-1'), (route) =>
      route.fulfill(
        jsonResponse({
          id: 'booking-1',
          loanerVehicleId: 'loaner-1',
          workshopOrderId: null,
          customerId: 'cust-1',
          plannedFrom: '2026-10-10T08:00:00.000Z',
          plannedTo: '2026-10-12T18:00:00.000Z',
          status: 'RESERVED',
          handedOverAt: null,
          returnedAt: null,
          odometerOut: null,
          odometerIn: null,
          fuelOut: null,
          fuelIn: null,
          driverLicenceChecked: false,
          licenceCheckedById: null,
          notes: null,
          createdAt: '2026-10-09T10:00:00.000Z',
          updatedAt: '2026-10-09T10:00:00.000Z',
          customer: { id: 'cust-1', firstName: 'Test', lastName: 'Customer', companyName: null },
        }),
      ),
    )
    await open(page, '/workshop/loaner-bookings/booking-1/print')

    await expect(page.locator('html')).toHaveClass(/\btheme-light\b/)
    expect(await backgroundBrightness(page)).toBeGreaterThan(0.9)
    await page.emulateMedia({ media: 'print' })
    expect(await backgroundBrightness(page)).toBeGreaterThan(0.9)

    // A finished print job (the Print button and Ctrl+P fire both events) must not turn the open print view dark again.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'))
      window.dispatchEvent(new Event('afterprint'))
    })
    await expect(page.locator('html')).toHaveClass(/\btheme-light\b/)
    expect(await backgroundBrightness(page)).toBeGreaterThan(0.9)
  })

  test('WHEN a returning dark user opens the app THEN the dark class is set before the app code runs', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('acp-theme', 'dark'))
    // Without the app bundle only the inline script in index.html can set the class.
    await page.route(/\/assets\/.*\.js(\?.*)?$/, (route) => route.abort())

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  })

  test('WHEN the menu is opened at 375px THEN the theme switch is usable with targets of at least 44px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await open(page)
    await page.locator('[data-sidebar="trigger"]').click()
    await openAccountMenu(page)

    for (const value of ['light', 'dark', 'system']) {
      const box = (await page.getByTestId(`theme-option-${value}`).boundingBox())!
      expect(box.height, value).toBeGreaterThanOrEqual(44)
      expect(box.x + box.width, value).toBeLessThanOrEqual(375)
    }
    await page.getByTestId('theme-option-dark').click()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await expectNoPageScroll(page)
  })

  // Regression (AUT-1029): System (and Hell/Dunkel) keep a name taken from the visible label, selected or not.
  test('WHEN the theme control is opened in DE THEN Hell, Dunkel, and System have matching accessible names whether selected or not', async ({ page }) => {
    await open(page)
    await openAccountMenu(page)

    const light = page.getByTestId('theme-option-light')
    const dark = page.getByTestId('theme-option-dark')
    const system = page.getByTestId('theme-option-system')

    await expect(system).toBeChecked()
    await expectThemeOptionName(light, 'Hell')
    await expectThemeOptionName(dark, 'Dunkel')
    await expectThemeOptionName(system, 'System')

    await dark.click()
    await openAccountMenu(page)

    await expect(dark).toBeChecked()
    await expect(system).not.toBeChecked()
    await expectThemeOptionName(light, 'Hell')
    await expectThemeOptionName(dark, 'Dunkel')
    await expectThemeOptionName(system, 'System')
  })

  test('WHEN the theme control is opened in EN THEN Light, Dark, and System have matching accessible names whether selected or not', async ({ page }) => {
    await open(page)
    await openAccountMenu(page)
    await page.getByTestId('language-option-en').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('menu')).toBeHidden()
    await openAccountMenu(page)

    const light = page.getByTestId('theme-option-light')
    const dark = page.getByTestId('theme-option-dark')
    const system = page.getByTestId('theme-option-system')

    await expect(system).toBeChecked()
    await expectThemeOptionName(light, 'Light')
    await expectThemeOptionName(dark, 'Dark')
    await expectThemeOptionName(system, 'System')

    await light.click()
    await openAccountMenu(page)

    await expect(light).toBeChecked()
    await expect(system).not.toBeChecked()
    await expectThemeOptionName(light, 'Light')
    await expectThemeOptionName(dark, 'Dark')
    await expectThemeOptionName(system, 'System')
  })

  test('WHEN the named System option is activated THEN the theme follows OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page)
    await openAccountMenu(page)
    await page.getByRole('menuitemradio', { name: 'Hell' }).click()
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

    await openAccountMenu(page)
    await page.getByRole('menuitemradio', { name: 'System' }).click()

    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    expect(await page.evaluate(() => window.localStorage.getItem('acp-theme'))).toBe('system')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    expect(await page.evaluate(() => window.localStorage.getItem('acp-theme'))).toBe('system')
  })
})

/** Name is the visible label, and the radio dot is hidden from the accessibility tree. */
async function expectThemeOptionName(option: ReturnType<Page['getByTestId']>, label: string) {
  await expect(option).toHaveAccessibleName(label)
  const labelId = await option.getAttribute('aria-labelledby')
  expect(labelId).toMatch(/\S/)
  const labelNode = option.locator(`[id="${labelId}"]`)
  await expect(labelNode).toHaveText(label)
  await expect(labelNode).toBeVisible()
  await expect(option.locator('> span').first()).toHaveAttribute('aria-hidden', 'true')
}

