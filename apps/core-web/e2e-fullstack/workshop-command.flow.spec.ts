import { expect, test, type Page } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession } from './harness.ts'

/**
 * Cmd+K command mode end to end: the reviewed preview becomes an AgentProposal,
 * the explicit apply links order + tasks + plan lines + loaner reservation, and a
 * competing proposal for the same bay fails traceably instead of reporting success.
 */
type WorkshopOrderSummary = {
  id: string
  order_number: string | null
  vehicle_id: string
  status: string
  bay_id: string | null
}

type WorkshopOrderDetail = WorkshopOrderSummary & {
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  tasks: Array<{ id: string; lineItems: unknown[] }>
  loanerBooking?: { status: string; displayName: string; plannedFrom: string | null }
}

type ProposalList = {
  data: Array<{ id: string; status: string; reason: string | null; action_type: string }>
}

const COMMAND_ENTRY = /Werkstatt-Befehl/

async function apiGet<T>(page: Page, path: string, token: string): Promise<T> {
  const response = await page.request.get(path, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.ok(), `GET ${path} failed with ${response.status()}`).toBeTruthy()
  return (await response.json()) as T
}

async function openCommandPanel(page: Page) {
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('combobox')).toBeVisible()
  await page.getByRole('option').filter({ hasText: COMMAND_ENTRY }).click()
  await expect(page.getByLabel('Satz')).toBeVisible()
}

async function reviewSentence(page: Page, sentence: string) {
  await page.getByLabel('Satz').fill(sentence)
  await page.getByRole('button', { name: 'Prüfen', exact: true }).click()
  await expect(previewOf(page)).toBeVisible()
}

/** The reviewed preview only; the sentence textarea repeats the same words. */
function previewOf(page: Page) {
  return page.locator('section[aria-labelledby="workshop-command-preview-heading"]')
}

test.describe('Full-stack Cmd+K workshop command flow', () => {
  test('flow 5: preview → proposal → explicit apply links order, plan and loaner, and a competing proposal stays failed', async ({
    page,
    context,
  }) => {
    const fixture = loadE2eFullstackFixture()
    const auth = fixture.authToken

    await gotoWithReadySession(page, '/')
    await openCommandPanel(page)
    await reviewSentence(page, fixture.commandSentence)

    const preview = previewOf(page)
    await expect(preview.getByText(fixture.commandCustomerLabel)).toBeVisible()
    await expect(preview.getByText(fixture.commandGolfLabel)).toBeVisible()
    await expect(preview.getByText(fixture.commandBayName)).toBeVisible()
    await expect(preview.getByText(/150 Min\./)).toBeVisible()
    await expect(preview.getByText('reserviert')).toBeVisible()
    await expect(preview.getByText('Großes Service')).toBeVisible()

    await page.getByRole('button', { name: 'Vorschlag übernehmen' }).click()
    await expect(page.getByRole('heading', { name: 'In der Freigabe-Queue' })).toBeVisible()
    await expect(page.getByText('Noch nicht angewendet')).toBeVisible()

    // Pending is not success: nothing is written before the explicit apply.
    const beforeApply = await apiGet<{ data: WorkshopOrderSummary[] }>(
      page,
      `/api/workshop/orders?customerId=${fixture.commandCustomerId}&pageSize=50`,
      auth,
    )
    expect(beforeApply.data).toHaveLength(0)

    // A second advisor queues the competing sentence for the same bay and time.
    const competing = await context.newPage()
    await gotoWithReadySession(competing, '/')
    await openCommandPanel(competing)
    await reviewSentence(competing, fixture.commandConflictSentence)
    await expect(previewOf(competing).getByText(fixture.commandPoloLabel)).toBeVisible()
    await competing.getByRole('button', { name: 'Vorschlag übernehmen' }).click()
    await expect(competing.getByRole('heading', { name: 'In der Freigabe-Queue' })).toBeVisible()

    await page.getByRole('button', { name: 'Jetzt anwenden' }).click()
    await expect(page.getByRole('heading', { name: 'Angewendet' })).toBeVisible()

    const afterApply = await apiGet<{ data: WorkshopOrderSummary[] }>(
      page,
      `/api/workshop/orders?customerId=${fixture.commandCustomerId}&pageSize=50`,
      auth,
    )
    expect(afterApply.data).toHaveLength(1)
    const order = afterApply.data[0]
    expect(order.vehicle_id).toBe(fixture.commandGolfVehicleId)
    expect(order.status).toBe('SCHEDULED')
    expect(order.bay_id).toBeTruthy()

    const detail = await apiGet<WorkshopOrderDetail>(
      page,
      `/api/workshop/orders/${order.id}`,
      auth,
    )
    expect(detail.scheduled_start_at).toBeTruthy()
    expect(detail.scheduled_end_at).toBeTruthy()
    expect(detail.tasks).toHaveLength(3)
    expect(detail.tasks.flatMap((task) => task.lineItems)).toHaveLength(3)
    expect(detail.loanerBooking).toMatchObject({
      status: 'RESERVED',
      displayName: fixture.commandLoanerName,
      plannedFrom: detail.scheduled_start_at,
    })

    await page.getByRole('button', { name: 'Werkstattaufträge öffnen' }).click()
    await expect(page).toHaveURL(/\/workshop\/orders$/)
    await expect(page.getByText(order.order_number ?? order.id)).toBeVisible()

    // The competing proposal now loses the bay: the UI reports the failure and keeps no success state.
    await competing.getByRole('button', { name: 'Jetzt anwenden' }).click()
    const conflictAlert = competing.getByRole('alert')
    await expect(conflictAlert).toContainText('Der Befehl konnte nicht verarbeitet werden.')
    await expect(conflictAlert).toContainText(/Bay is already occupied/)
    await expect(competing.getByRole('heading', { name: 'Angewendet' })).toHaveCount(0)

    const failed = await apiGet<ProposalList>(
      competing,
      '/api/agent-proposals?status=FAILED&limit=50',
      auth,
    )
    expect(
      failed.data.some(
        (proposal) =>
          proposal.action_type === 'workshop.booking_package' &&
          /Bay is already occupied/.test(proposal.reason ?? ''),
      ),
    ).toBeTruthy()

    const afterConflict = await apiGet<{ data: WorkshopOrderSummary[] }>(
      competing,
      `/api/workshop/orders?customerId=${fixture.commandCustomerId}&pageSize=50`,
      auth,
    )
    expect(afterConflict.data.map((entry) => entry.vehicle_id)).not.toContain(
      fixture.commandPoloVehicleId,
    )
    expect(afterConflict.data).toHaveLength(1)

    await competing.close()
  })

  test('flow 5b: leaving the command mode returns to the unchanged search palette', async ({ page }) => {
    await gotoWithReadySession(page, '/')

    await openCommandPanel(page)
    await page.getByRole('button', { name: 'Zurück zur Suche' }).click()
    await expect(page.getByRole('combobox')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('combobox')).toBeHidden()
  })
})
