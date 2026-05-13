import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'

test.describe('Mechanic voice-note diagnostics flow', () => {
  const TASK_ID = '22222222-2222-2222-2222-222222222222'

  test('records voice note, reviews draft, and accepts into diagnostics autosave', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Mechanic')
    let currentNotes = 'Initial typed note'

    await page.addInitScript(() => {
      class MockMediaRecorder {
        static isTypeSupported(mimeType: string) {
          return [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg;codecs=opus',
          ].includes(mimeType)
        }

        state = 'inactive'
        mimeType = 'audio/webm'
        ondataavailable = null
        onstop = null
        onerror = null

        constructor(_stream: unknown, options?: { mimeType?: string }) {
          if (options?.mimeType) {
            this.mimeType = options.mimeType
          }
        }

        start() {
          this.state = 'recording'
        }

        stop() {
          this.state = 'inactive'
          this.ondataavailable?.({
            data: new Blob(['voice-note'], { type: this.mimeType }),
          })
          this.onstop?.()
        }
      }

      Object.defineProperty(window, 'MediaRecorder', {
        configurable: true,
        writable: true,
        value: MockMediaRecorder,
      })

      Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        writable: true,
        value: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop: () => undefined }],
          }),
        },
      })
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            taskId: TASK_ID,
            taskTitle: 'Oil Change',
            taskStatus: 'IN_PROGRESS',
            mechanicNotes: currentNotes,
            orderId: 'order-1',
            orderNumber: 'WO-2026-0001',
            reportedComplaint: 'Engine light on',
            odometer: 80000,
            vehicle: {
              id: 'v1',
              make: 'BMW',
              model: '320d',
              year: 2022,
              vin: 'VIN123',
              plate: 'W-TEST-1',
            },
            bay: null,
            sequence: 1,
            scheduledDate: null,
            lineItems: [],
            createdAt: '2026-04-28T10:00:00.000Z',
            updatedAt: '2026-04-28T10:00:00.000Z',
          }),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}/voice-notes`),
      async (route) => {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            text: 'Voice draft from recording',
            detectedLanguage: 'en',
            provider: 'openai',
            model: 'whisper-1',
            durationSeconds: 2,
          }),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}/diagnostics`),
      async (route) => {
        const payload = JSON.parse(route.request().postData() ?? '{}') as { mechanicNotes?: string }
        currentNotes = payload.mechanicNotes ?? currentNotes
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            taskId: TASK_ID,
            mechanicNotes: currentNotes,
          }),
        })
      },
    )

    await corePage.navigate(`/mechanic/tasks/${TASK_ID}`)

    const diagnosticsTextarea = page.getByPlaceholder('Record diagnostic findings, measurements, or notes here…')
    await expect(diagnosticsTextarea).toHaveValue('Initial typed note')

    await page.getByRole('button', { name: /record voice note/i }).click()
    await expect(page.getByRole('button', { name: /stop recording/i })).toBeVisible()
    await page.getByRole('button', { name: /stop recording/i }).click()

    const draftTextarea = page.getByLabel('Voice-note draft')
    await expect(draftTextarea).toBeVisible()
    await expect(draftTextarea).toHaveValue('Voice draft from recording')
    await draftTextarea.fill('Edited from voice note')

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/mechanic/tasks/${TASK_ID}/diagnostics`) &&
        response.request().method() === 'PATCH',
    )

    await page.getByRole('button', { name: /accept draft/i }).click()
    await saveResponsePromise

    await expect(diagnosticsTextarea).toHaveValue('Initial typed note\n\nEdited from voice note')
    await expect(page.getByText('Saved ✓')).toBeVisible()
  })
})
