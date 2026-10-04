import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { expectNoCriticalA11yViolations } from './utils/a11y'

test.describe('Agent Supervision Screen (AUT-401)', () => {
  const mockProposals = [
    {
      id: 'prop-1',
      tenant_id: 'test-tenant',
      trace_id: '11111111-1111-1111-1111-111111111111',
      action_type: 'sales_order.apply_discount',
      tier: 'PROPOSE',
      status: 'PENDING',
      payload_json: {
        agent_id: 'sales-agent',
        entity_type: 'SalesOrder',
        entity_id: 'so-123',
        amount_cents: 15000,
      },
      preview_json: {
        diff: '- 150.00 EUR discount',
      },
      decided_by: null,
      decided_at: null,
      reason: null,
      expires_at: '2026-10-11T12:00:00.000Z',
      created_at: '2026-10-04T12:00:00.000Z',
      updated_at: '2026-10-04T12:00:00.000Z',
    },
    {
      id: 'prop-2',
      tenant_id: 'test-tenant',
      trace_id: '22222222-2222-2222-2222-222222222222',
      action_type: 'payment.refund_customer',
      tier: 'HUMAN_ONLY',
      status: 'PENDING',
      payload_json: {
        agent_id: 'billing-agent',
        entity_type: 'Customer',
        entity_id: 'cust-456',
        amount_cents: 50000,
      },
      preview_json: null,
      decided_by: null,
      decided_at: null,
      reason: null,
      expires_at: '2026-10-11T12:00:00.000Z',
      created_at: '2026-10-04T12:00:00.000Z',
      updated_at: '2026-10-04T12:00:00.000Z',
    },
  ]

  const mockLogs = [
    {
      id: 'log-1',
      tenantId: 'test-tenant',
      traceId: '11111111-1111-1111-1111-111111111111',
      actorType: 'AGENT',
      agentId: 'sales-agent',
      actionType: 'sales_order.apply_discount',
      tier: 'PROPOSE',
      status: 'EXECUTED',
      onBehalfOfUserId: 'supervisor-1',
      reversible: true,
      createdAt: '2026-10-04T12:05:00.000Z',
    },
  ]

  const mockTraceDetail = {
    logs: mockLogs,
    auditEntries: [
      {
        id: 'audit-1',
        tenantId: 'test-tenant',
        entityType: 'SalesOrder',
        entityId: 'so-123',
        action: 'UPDATE',
        actorEmail: 'supervisor@example.com',
        actorType: 'USER',
        occurredAt: '2026-10-04T12:05:01.000Z',
      },
    ],
  }

  test.beforeEach(async ({ page }) => {
    // Mock Sites API
    await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    // Mock Agent Proposals API
    await page.route(AutoCorePage.apiRouteMatcher('/api/agent-proposals'), async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockProposals }),
        })
        return
      }
      await route.continue()
    })

    // Mock Agent Actions API
    await page.route(AutoCorePage.apiRouteMatcher('/api/agent-actions'), async (route) => {
      const url = route.request().url()
      if (url.includes('11111111-1111-1111-1111-111111111111')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockTraceDetail),
        })
        return
      }

      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockLogs }),
        })
        return
      }
      await route.continue()
    })
  })

  test('renders persistent safety banner, proposal queue, and passes axe a11y', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Agent Supervision')
    await corePage.navigate('/agent/supervision')

    // Verify Heading & Safety Banner
    await expect(page.getByRole('heading', { level: 1, name: 'Agent Supervision' })).toBeVisible()
    const safetyBanner = page.getByTestId('agent-safety-banner')
    await expect(safetyBanner).toBeVisible()
    await expect(safetyBanner).toContainText('Agent supervision active')

    // Verify proposals queue
    await expect(page.getByTestId('proposal-card-prop-1')).toBeVisible()
    await expect(page.getByTestId('approve-btn-prop-1')).toBeVisible()
    await expect(page.getByTestId('reject-btn-prop-1')).toBeVisible()

    // CRITICAL SAFETY GUARD: HUMAN_ONLY has no approve button, shows "Do this manually"
    await expect(page.getByTestId('proposal-card-prop-2')).toBeVisible()
    await expect(page.getByTestId('approve-btn-prop-2')).not.toBeVisible()
    await expect(page.getByText('Do this manually')).toBeVisible()

    // Axe a11y audit on Approvals view
    await expectNoCriticalA11yViolations(page)
  })

  test('switches tabs to Activity view and passes axe a11y', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Agent Supervision')
    await corePage.navigate('/agent/supervision')

    // Switch to Activity tab
    const activityTab = page.getByTestId('tab-activity')
    await activityTab.click()

    await expect(page.getByTestId('activity-tab')).toBeVisible()
    await expect(page.getByTestId('activity-table')).toBeVisible()
    await expect(page.getByTestId('activity-row-log-1')).toBeVisible()

    // Axe a11y audit on Activity view
    await expectNoCriticalA11yViolations(page)
  })

  test('toggles language to German and back to English', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Agent Supervision')
    await corePage.navigate('/agent/supervision')

    const langBtn = page.getByTestId('toggle-language-btn')
    await langBtn.click()

    await expect(page.getByRole('heading', { level: 1, name: 'Agenten-Überwachung' })).toBeVisible()
    await expect(page.getByTestId('agent-safety-banner')).toContainText('Agenten-Überwachung aktiv')

    // Axe a11y audit in German mode
    await expectNoCriticalA11yViolations(page)

    // Switch back to English
    await langBtn.click()
    await expect(page.getByRole('heading', { level: 1, name: 'Agent Supervision' })).toBeVisible()
  })
})
