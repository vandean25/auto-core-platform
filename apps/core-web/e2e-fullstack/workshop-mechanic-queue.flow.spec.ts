import { test, expect } from '@playwright/test'
import { loadE2eFullstackFixture } from './fixture.ts'
import { gotoWithReadySession, useApiBearerToken } from './harness.ts'
import { DE_FULLSTACK_STATUS, DE_FULLSTACK_WORKSHOP } from './de-copy.ts'
import { workshopOrderAssignAria } from '../e2e/helpers/de-workshop.ts'

test.describe('Full-stack workshop mechanic queue flow', () => {
  test('flow 4: assign on board → mechanic queue → start and complete task', async ({
    page,
  }) => {
    const fixture = loadE2eFullstackFixture()

    await gotoWithReadySession(page, '/workshop/board')
    await expect(page.getByTestId('board-column-unassigned')).toBeVisible()
    await expect(page.getByTestId('board-column-unassigned')).toContainText(
      fixture.workshopOrderNumber,
    )

    const assignResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/workshop/board/assign') &&
        response.request().method() === 'PATCH',
    )
    await page
      .getByRole('button', {
        name: workshopOrderAssignAria(fixture.workshopOrderNumber),
      })
      .click()
    await page.getByTestId(`assign-mechanic-${fixture.mechanicEmployeeId}`).click()
    const assignResult = await assignResponse
    expect(assignResult.ok()).toBeTruthy()

    await useApiBearerToken(page, fixture.mechanicAuthToken)

    await page.goto('/mechanic/queue')
    await expect(
      page.getByRole('heading', { name: DE_FULLSTACK_WORKSHOP.mechanicQueueTitle }),
    ).toBeVisible()
    await expect(page.getByText(fixture.workshopTaskTitle)).toBeVisible()

    await page.getByRole('link', { name: fixture.workshopTaskTitle }).click()
    await expect(page).toHaveURL(`/mechanic/tasks/${fixture.workshopTaskId}`)

    await page
      .getByRole('button', { name: DE_FULLSTACK_WORKSHOP.mechanicTask.start, exact: true })
      .click()
    await page
      .getByRole('button', { name: DE_FULLSTACK_WORKSHOP.mechanicTask.complete, exact: true })
      .click()

    await expect(page.getByText(DE_FULLSTACK_STATUS.DONE).first()).toBeVisible()
  })
})
