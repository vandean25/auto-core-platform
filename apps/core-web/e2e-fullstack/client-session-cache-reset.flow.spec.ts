import { expect, test, type Page, type Route } from '@playwright/test'
import { E2E_TEST_SIGN_IN_EVENT } from '../src/auth/e2e-test-token-user.ts'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'
import { createMockCustomer, createMockListResponse } from '../e2e/utils/mock-factories.ts'

/**
 * AUT-819: after a tenant switch, a site switch or a sign-out followed by another user signing in in the same tab, the
 * previous user's, tenant's or site's records must never stay on screen, not even while the new context's data is
 * still loading. The fullstack harness runs with a fixed test token, so switches, the switch endpoints and the
 * follow-up list responses are exercised against the real shell and controlled here. The harness has no Firebase;
 * the sign-in of the second user goes through the test-token seam (`acp:e2e-test-sign-in`).
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

const USER_B = {
  uid: 'e2e-fullstack-user-b',
  email: 'e2e-fullstack-user-b@auto.core.test',
  displayName: 'User B',
}

const USER_A_EMAIL = 'e2e-fullstack@auto.core.test'
const SAVED_VIEW_A = 'A gespeicherte Ansicht'
const DASHBOARD_WIDGET_A = 'A Dashboard Widget'

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

  test('the next user signing in on the same tab never sees the previous user\'s data', async ({ page }) => {
    const fixture = loadE2eFullstackFixture()
    const state: SessionState = { switched: false, lastSession: null }
    const customersGate = deferred()

    await routeSession(page, state, () => ({
      activeTenant: TENANT_B,
      activeRole: 'ADMIN',
      activeSiteId: null,
    }))
    await routeCustomerListAfterSwitch(page, state, customersGate.promise)

    await gotoWithReadySession(page, '/customers')
    await expect(
      page.locator('[data-table-row="true"]').filter({ hasText: fixture.customerLabel }),
    ).toBeVisible()

    // Per-user views and the dashboard layout of the previous user on this shared browser.
    await page.evaluate(() => {
      localStorage.setItem('acp:saved-views:e2e-fullstack-user', JSON.stringify([
        { id: 'saved-view-a', name: 'A gespeicherte Ansicht', href: '/customers', createdAt: '2026-10-30T10:00:00.000Z' },
      ]))
      localStorage.setItem('acp:dashboard-widgets:e2e-fullstack-user', JSON.stringify([
        {
          id: 'widget-a',
          name: 'A Dashboard Widget',
          sourceKey: 'customers',
          sourceLabel: 'customers',
          href: '/customers',
          displayType: 'list',
          createdAt: '2026-10-30T10:00:00.000Z',
        },
      ]))
    })
    await page.reload()
    await expect(page.getByRole('link', { name: SAVED_VIEW_A })).toBeVisible()
    await expect(
      page.locator('[data-table-row="true"]').filter({ hasText: fixture.customerLabel }),
    ).toBeVisible()

    await page.getByRole('button', { name: USER_A_EMAIL }).click()
    await page.getByRole('menuitem', { name: 'Abmelden' }).click()

    // Signed out: the login screen is shown and nothing of the previous user is left on screen. The harness has no
    // Firebase, so the card shows the unconfigured note instead of the sign-in form.
    await expect(page.getByRole('heading', { name: 'Anmelden', level: 2 })).toBeVisible()
    await expect(page.getByText('Anmeldung ist für diese Umgebung nicht konfiguriert.')).toBeVisible()
    await expect(page.getByText(fixture.customerLabel)).toHaveCount(0)
    await expect(page.getByRole('link', { name: SAVED_VIEW_A })).toHaveCount(0)

    // User B signs in on the same tab; the harness has no Firebase, so this uses the test-token sign-in seam.
    state.switched = true
    await page.evaluate(
      ({ eventName, user }) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: user }))
      },
      { eventName: E2E_TEST_SIGN_IN_EVENT, user: USER_B },
    )

    // B's customer request is still pending: no record from A may be rendered in the meantime.
    await expect(page.getByRole('button', { name: new RegExp(TENANT_B.name) })).toBeVisible()
    await expect(page.getByText(fixture.customerLabel)).toHaveCount(0)
    await expect(page.getByText(TENANT_B_CUSTOMER_LABEL)).toHaveCount(0)
    await expect(page.getByRole('link', { name: SAVED_VIEW_A })).toHaveCount(0)

    customersGate.resolve()
    await expect(page.getByText(TENANT_B_CUSTOMER_LABEL)).toBeVisible()

    // The dashboard layout is B's own (empty), never A's.
    await page.getByRole('link', { name: 'Dashboard' }).first().click()
    await expect(page.getByText(/Noch keine Widgets/)).toBeVisible()
    await expect(page.getByText(DASHBOARD_WIDGET_A)).toHaveCount(0)

    // A's per-user data survives for A on this browser, but is not read under B's key.
    const stored = await page.evaluate(() => ({
      previousUserViews: localStorage.getItem('acp:saved-views:e2e-fullstack-user'),
      nextUserViews: localStorage.getItem('acp:saved-views:e2e-fullstack-user-b'),
      nextUserWidgets: localStorage.getItem('acp:dashboard-widgets:e2e-fullstack-user-b'),
    }))
    expect(stored.previousUserViews).toContain(SAVED_VIEW_A)
    expect(stored.nextUserViews ?? '').not.toContain(SAVED_VIEW_A)
    expect(stored.nextUserWidgets ?? '').not.toContain(DASHBOARD_WIDGET_A)
  })
})
