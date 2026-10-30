import { expect, test, type Page, type Route } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'
import { createMockCustomer, createMockListResponse } from '../e2e/utils/mock-factories.ts'

/**
 * AUT-819: after a tenant or site switch the previous context's records must never stay on screen, not even while the
 * new context's data is still loading. The fullstack harness runs with a fixed test token, so tenant and site switches
 * are exercised against the real shell and the real switch endpoints, with the switch response and the follow-up list
 * responses controlled here. Sign-out and a Firebase uid change have no such seam and are covered by the core-web
 * unit/component suites instead.
 */

const TENANT_B = {
  id: 'e2e-fullstack-tenant-b',
  name: 'Auto Core Graz',
  slug: 'graz',
}

const SITE_B = {
  id: 'e2e-fullstack-site-b',
  code: 'SITE-B',
  name: 'Standort B',
}

const TENANT_B_CUSTOMER_LABEL = 'Tenant B Kunde'

type SessionBody = Record<string, unknown>
type Membership = { tenantId: string }

type SessionState = {
  switched: boolean
  lastSession: SessionBody | null
}

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function fulfillAfterGate(
  route: Route,
  gate: Promise<void>,
  json: unknown,
): Promise<void> {
  await gate
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(json),
  })
}

function customerListBody() {
  return createMockListResponse([
    createMockCustomer({
      id: 'e2e-fullstack-tenant-b-customer',
      first_name: 'Tenant',
      last_name: 'B Kunde',
      email: 'tenant-b@auto.core.test',
    }),
  ])
}

function isCustomerCollectionRequest(route: Route): boolean {
  return new URL(route.request().url()).pathname === '/api/customers'
}

/**
 * Serves `/api/auth/me` and adds a second membership, so the sidebar offers a tenant switch. After `switched`, the
 * session reports the context that `nextActive` returns.
 */
async function routeSession(
  page: Page,
  state: SessionState,
  nextActive: () => SessionBody,
) {
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch()
    const session = (await response.json()) as SessionBody
    state.lastSession = session
    const memberships = [
      ...((session.memberships as Membership[]).filter(
        (membership) => membership.tenantId !== TENANT_B.id,
      )),
      {
        tenantId: TENANT_B.id,
        tenantName: TENANT_B.name,
        tenantSlug: TENANT_B.slug,
        role: 'ADMIN',
        isActive: state.switched,
      },
    ]

    await route.fulfill({
      response,
      json: {
        ...session,
        memberships,
        ...(state.switched ? nextActive() : {}),
      },
    })
  })
}

/** Every site list request gets one more site, so the switcher offers a second one. */
async function routeSites(page: Page) {
  await page.route('**/api/me/sites', async (route) => {
    const response = await route.fetch()
    const sites = (await response.json()) as Array<{ legalEntityId: string }>
    const legalEntityId = sites[0]?.legalEntityId ?? 'e2e-fullstack-legal-entity'
    await route.fulfill({
      response,
      json: [...sites, { ...SITE_B, legalEntityId }],
    })
  })
}

async function routeSwitchEndpoint(
  page: Page,
  path: string,
  state: SessionState,
  gate: Promise<void>,
  responseBody: () => SessionBody,
) {
  await page.route(`**${path}`, async (route) => {
    state.switched = true
    await fulfillAfterGate(route, gate, responseBody())
  })
}

async function routeCustomerListAfterSwitch(
  page: Page,
  state: SessionState,
  gate: Promise<void>,
) {
  await page.route('**/api/customers**', async (route) => {
    if (!isCustomerCollectionRequest(route)) {
      await route.continue()
      return
    }
    if (!state.switched) {
      await route.continue()
      return
    }
    await fulfillAfterGate(route, gate, customerListBody())
  })
}

test.describe('Full-stack client session reset (AUT-819)', () => {
  test('tenant switch never shows records of the tenant being left', async ({ page }) => {
    const fixture = loadE2eFullstackFixture()
    const state: SessionState = { switched: false, lastSession: null }
    const tenantSwitchGate = deferred()
    const customersGate = deferred()

    await routeSession(page, state, () => ({
      activeTenant: TENANT_B,
      activeRole: 'ADMIN',
      activeSiteId: null,
    }))
    await routeSwitchEndpoint(
      page,
      '/api/auth/switch-tenant',
      state,
      tenantSwitchGate.promise,
      () => ({ ...state.lastSession, activeTenant: TENANT_B, activeRole: 'ADMIN' }),
    )
    await routeCustomerListAfterSwitch(page, state, customersGate.promise)

    const session = await gotoWithReadySession(page, '/customers')
    await expect(
      page.locator('[data-table-row="true"]').filter({ hasText: fixture.customerLabel }),
    ).toBeVisible()

    await page.getByRole('button', { name: new RegExp(session.activeTenant.name) }).click()
    await page.getByRole('menuitem', { name: `Zu ${TENANT_B.name} wechseln` }).click()

    // While the switch is in flight the old tenant's records are gone.
    await expect(page.getByText('Laden…', { exact: true })).toBeVisible()
    await expect(page.getByText(fixture.customerLabel)).toHaveCount(0)

    tenantSwitchGate.resolve()

    // The shell may come back before the new tenant's list does: the old records still may not return.
    await expect(page.getByRole('button', { name: new RegExp(TENANT_B.name) })).toBeVisible()
    await expect(page.getByText(fixture.customerLabel)).toHaveCount(0)

    customersGate.resolve()
    await expect(page.getByText(TENANT_B_CUSTOMER_LABEL)).toBeVisible()
  })

  test('site switch never shows records of the site being left', async ({ page }) => {
    const fixture = loadE2eFullstackFixture()
    const state: SessionState = { switched: false, lastSession: null }
    const siteSwitchGate = deferred()
    const customersGate = deferred()

    await routeSession(page, state, () => ({
      activeSiteId: SITE_B.id,
    }))
    await routeSites(page)
    await routeSwitchEndpoint(
      page,
      '/api/me/active-site',
      state,
      siteSwitchGate.promise,
      () => ({ activeSiteId: SITE_B.id }),
    )
    await routeCustomerListAfterSwitch(page, state, customersGate.promise)

    const session = await gotoWithReadySession(page, '/customers')
    await expect(
      page.locator('[data-table-row="true"]').filter({ hasText: fixture.customerLabel }),
    ).toBeVisible()

    await page.getByRole('button', { name: new RegExp(session.activeTenant.name) }).click()
    await page.getByRole('menuitemradio', { name: new RegExp(SITE_B.name) }).click()

    // While the switch is in flight the old site's records must not be visible.
    await expect(page.getByText('Laden…', { exact: true })).toBeVisible()
    await expect(page.getByText(fixture.customerLabel)).toHaveCount(0)

    siteSwitchGate.resolve()

    // The shell may come back before the new site's list does: the old records still may not return.
    await expect(page.getByText(fixture.customerLabel)).toHaveCount(0)

    customersGate.resolve()
    await expect(page.getByText(TENANT_B_CUSTOMER_LABEL)).toBeVisible()
  })
})
