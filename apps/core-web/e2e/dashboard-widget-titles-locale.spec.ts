import { expect, test, type Page } from '@playwright/test'
import deCommon from '../../../locales/de/common.json' with { type: 'json' }
import enCommon from '../../../locales/en/common.json' with { type: 'json' }
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_SHELL } from './helpers/de-shell'
import { createMockListResponse, createMockVehicleListItem } from './utils/mock-factories'
import { pageOverflow } from './utils/phone-layout'

const VEHICLE_SOURCE = deCommon.dashboard.sources.vehicles
const DE_TITLES = {
  list: deCommon.dashboard.builtInWidgetTitle.list.replace('{{sourceLabel}}', VEHICLE_SOURCE),
  total: deCommon.dashboard.builtInWidgetTitle.metricCount.replace('{{sourceLabel}}', VEHICLE_SOURCE),
  donut: deCommon.dashboard.builtInWidgetTitle.donut.replace('{{sourceLabel}}', VEHICLE_SOURCE),
}
const EN_TITLES = {
  list: enCommon.dashboard.builtInWidgetTitle.list.replace('{{sourceLabel}}', enCommon.dashboard.sources.vehicles),
  total: enCommon.dashboard.builtInWidgetTitle.metricCount.replace('{{sourceLabel}}', enCommon.dashboard.sources.vehicles),
  donut: enCommon.dashboard.builtInWidgetTitle.donut.replace('{{sourceLabel}}', enCommon.dashboard.sources.vehicles),
}

const LEGACY_ENGLISH_NAMES = ['Vehicles List', 'Vehicles Total', 'Vehicles Donut'] as const

type LegacyWidgetSeed = {
  id: string
  name: (typeof LEGACY_ENGLISH_NAMES)[number]
  displayType: 'list' | 'metric' | 'donut'
  groupByField?: string
  metricCalculation?: 'count'
}

const LEGACY_VEHICLE_WIDGETS: LegacyWidgetSeed[] = [
  { id: 'veh-list', name: 'Vehicles List', displayType: 'list' },
  { id: 'veh-total', name: 'Vehicles Total', displayType: 'metric', metricCalculation: 'count' },
  { id: 'veh-donut', name: 'Vehicles Donut', displayType: 'donut', groupByField: 'make' },
]

async function seedLegacyVehicleWidgets(page: Page) {
  const payload = LEGACY_VEHICLE_WIDGETS.map((widget) => ({
    id: widget.id,
    name: widget.name,
    sourceKey: 'vehicles',
    sourceLabel: 'Vehicles',
    href: '/vehicles',
    displayType: widget.displayType,
    groupByField: widget.groupByField,
    metricCalculation: widget.metricCalculation,
    createdAt: '2026-01-01T00:00:00.000Z',
  }))
  await page.addInitScript((widgets) => {
    window.localStorage.setItem('acp:dashboard-widgets:e2e-test-user', JSON.stringify(widgets))
  }, payload)
}

async function mockVehiclesApi(page: Page) {
  await page.route(AutoCorePage.apiRouteMatcher('/api/vehicles'), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        createMockListResponse([
          createMockVehicleListItem({ id: 'v1', make: 'BMW', model: 'X1', plate: 'W-1001' }),
          createMockVehicleListItem({ id: 'v2', make: 'Audi', model: 'A4', plate: 'W-1002' }),
        ]),
      ),
    })
  })
}

async function openDashboard(page: Page) {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
}

async function expectGermanVehicleWidgetTitles(page: Page) {
  await expect(page.getByText(DE_TITLES.list)).toBeVisible()
  await expect(page.getByText(DE_TITLES.total)).toBeVisible()
  await expect(page.getByText(DE_TITLES.donut)).toBeVisible()
  for (const legacy of LEGACY_ENGLISH_NAMES) {
    await expect(page.getByText(legacy, { exact: true })).not.toBeVisible()
  }
}

async function switchLanguage(page: Page, language: 'de' | 'en') {
  await page.getByRole('button', { name: DE_SHELL.user.accountEmail }).click()
  await page.getByTestId(`language-option-${language}`).click()
  await expect(page.locator('html')).toHaveAttribute('lang', language)
  await page.keyboard.press('Escape')
}

test.describe('AUT-970 dashboard widget titles follow locale', () => {
  test.beforeEach(async ({ page }) => {
    await seedLegacyVehicleWidgets(page)
    await mockVehiclesApi(page)
  })

  test('shows German titles for legacy English vehicle widgets on desktop', async ({ page }) => {
    await openDashboard(page)
    await expectGermanVehicleWidgetTitles(page)
  })

  test('shows German titles without horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openDashboard(page)
    await expectGermanVehicleWidgetTitles(page)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(1)
  })

  test('shows English titles when the dashboard locale is EN', async ({ page }) => {
    await openDashboard(page)
    await switchLanguage(page, 'en')
    await expect(page.getByText(EN_TITLES.list)).toBeVisible()
    await expect(page.getByText(EN_TITLES.total)).toBeVisible()
    await expect(page.getByText(EN_TITLES.donut)).toBeVisible()
    await expect(page.getByText('dashboard.builtInWidgetTitle.list')).not.toBeVisible()
  })

  test('keeps German titles after hard reload and a later visit', async ({ page }) => {
    await openDashboard(page)
    await expectGermanVehicleWidgetTitles(page)

    await page.reload({ waitUntil: 'networkidle' })
    await expectGermanVehicleWidgetTitles(page)

    await page.goto('/inventory')
    await page.waitForLoadState('networkidle')
    await openDashboard(page)
    await expectGermanVehicleWidgetTitles(page)
  })
})
