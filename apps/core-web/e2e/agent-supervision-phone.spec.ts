import { test, expect } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_AGENT } from './helpers/de-agent'
import { contentClippedByAncestor, controlsOutsideTheirCard, controlsShorterThan44, expectNoPageScroll, PHONE_WIDTHS } from './utils/phone-layout'

/** AUT-748: the three supervision tabs, their filters and cards fit a phone without horizontal page scroll. */
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

const proposal = (id: string, tier: string) => ({
  id,
  tenant_id: 'test-tenant',
  trace_id: `${id}-1111-1111-1111-111111111111`,
  action_type: 'sales_order.apply_discount',
  tier,
  status: 'PENDING',
  payload_json: { agent_id: 'sales-agent', entity_type: 'SalesOrder', entity_id: 'so-123', amount_cents: 15000 },
  preview_json: tier === 'PROPOSE' ? { diff: '- 150.00 EUR discount' } : null,
  decided_by: null,
  decided_at: null,
  reason: null,
  expires_at: '2026-10-11T12:00:00.000Z',
  created_at: '2026-10-04T12:00:00.000Z',
  updated_at: '2026-10-04T12:00:00.000Z',
})
const proposals = [proposal('prop-1', 'PROPOSE'), proposal('prop-2', 'HUMAN_ONLY')]
const logs = [
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
const auditEntry = {
  id: 'audit-1',
  tenantId: 'test-tenant',
  entityType: 'SalesOrder',
  entityId: 'so-123',
  action: 'UPDATE',
  actorEmail: 'supervisor.with.a.very.long.mailbox.name@subdomain.example-workshop-group.test',
  actorType: 'USER',
  occurredAt: '2026-10-04T12:05:01.000Z',
}
const shadowLogs = [
  {
    id: 'shadow-1',
    traceId: '33333333-3333-3333-3333-333333333333',
    useCase: 'document_sort',
    suggestion: { choice: 'Lieferschein', confidence: 0.6, rationale: 'Made-up delivery note keywords' },
    actualOutcome: { choice: 'Rechnung', source: 'heuristic_classifier' },
    latencyMs: 95,
    error: null,
    provider: 'openrouter-jev',
    model: 'typesafe/jev-1.13',
    match: false,
    createdAt: '2026-10-02T09:30:00.000Z',
  },
]

test.describe('Agent supervision on a phone (AUT-748)', () => {
  for (const width of PHONE_WIDTHS) {
    test(`tabs, filters and tables fit at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 812 })
      await page.route(AutoCorePage.apiRouteMatcher('/api/me/sites'), (route) => route.fulfill(json([])))
      await page.route(AutoCorePage.apiRouteMatcher('/api/agent-supervision/triage'), (route) => route.fulfill(json({ data: proposals.map((item) => ({ kind: 'PENDING_APPROVAL', entity_id: item.id, site_id: 'test-site', reason: 'AGENT_PROPOSAL_PENDING', created_at: item.created_at, due_at: item.expires_at, record_link: '/agent/supervision', allowed_action: 'APPROVE_REJECT' })), next_cursor: null })))
      await page.route(AutoCorePage.apiRouteMatcher('/api/agent-proposals'), (route) => route.fulfill(json({ data: proposals })))
      await page.route(AutoCorePage.apiRouteMatcher('/api/agent-actions'), (route) => route.fulfill(json({ data: logs })))
      await page.route(/\/api\/agent-actions\/[^?/]+(\?.*)?$/, (route) => route.fulfill(json({ logs, auditEntries: [auditEntry] })))
      await page.route(AutoCorePage.apiRouteMatcher('/api/decision-shadow-logs'), (route) => route.fulfill(json({ data: shadowLogs, nextCursor: null })))

      await new AutoCorePage(page, DE_AGENT.header.title).navigate('/agent/supervision')
      await expectNoPageScroll(page)

      for (const [testId, content] of [
        ['tab-approvals', 'approvals-tab'],
        ['tab-activity', 'activity-tab'],
        ['tab-decision-shadow', 'decision-shadow-tab'],
      ] as const) {
        const tab = page.getByTestId(testId)
        await tab.click()
        await expect(page.getByTestId(content)).toBeVisible()

        // The tab label is fully visible: inside the screen, not clipped, not overlapping its neighbours.
        const box = (await tab.boundingBox())!
        expect(box.x + box.width, `${testId} right edge`).toBeLessThanOrEqual(width)
        expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(44)
        expect(await tab.evaluate((node) => node.scrollWidth - node.clientWidth), `${testId} text clipped`).toBeLessThanOrEqual(0)

        await expectNoPageScroll(page)
        expect(await controlsShorterThan44(page.getByTestId('agent-supervision-page')), 'controls under 44px').toEqual([])
        expect(await controlsOutsideTheirCard(page.getByTestId(content)), 'controls wider than their card').toEqual([])
        await testInfo.attach(`${testId}-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
      }

      // The dialogs opened from the tabs are full-screen forms with 44px controls too.
      await page.getByTestId('tab-activity').click()
      await page.getByTestId('activity-trace-btn-log-1').click()
      const traceDialog = page.getByRole('dialog')
      await expect(traceDialog).toBeVisible()
      await expect(traceDialog.getByText(DE_AGENT.traceDialog.actionHistory)).toBeVisible()
      expect((await traceDialog.boundingBox())!.width).toBe(width)
      expect(await controlsShorterThan44(traceDialog), 'trace dialog controls under 44px').toEqual([])
      expect(await contentClippedByAncestor(traceDialog), 'trace dialog content clipped').toEqual([])
      await expectNoPageScroll(page)
      await page.keyboard.press('Escape')

      await page.getByTestId('tab-approvals').click()
      await page.getByTestId('reject-btn-prop-1').click()
      const rejectDialog = page.getByRole('dialog')
      await expect(rejectDialog).toBeVisible()
      expect((await rejectDialog.boundingBox())!.width).toBe(width)
      expect(await controlsShorterThan44(rejectDialog), 'reject dialog controls under 44px').toEqual([])
      expect(await contentClippedByAncestor(rejectDialog), 'reject dialog content clipped').toEqual([])
      await expectNoPageScroll(page)
      await page.keyboard.press('Escape')

      const boxes = await Promise.all(['tab-approvals', 'tab-activity', 'tab-decision-shadow'].map((id) => page.getByTestId(id).boundingBox()))
      for (let index = 1; index < boxes.length; index += 1) {
        const previous = boxes[index - 1]!
        const current = boxes[index]!
        const separate = current.x >= previous.x + previous.width - 1 || current.y >= previous.y + previous.height - 1
        expect(separate, `tab ${index} overlaps tab ${index - 1}`).toBe(true)
      }
    })
  }
})
