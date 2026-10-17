import { expect, test } from '@playwright/test'
import { AutoCorePage } from './pom/AutoCorePage'
import { DE_WORKSHOP } from './helpers/de-workshop'

/**
 * Injects a synchronous MockMediaRecorder into the page context so that
 * Playwright tests can exercise the voice-note recording flow without a
 * real microphone.  The mock behaves identically to the component-test
 * mock: start() sets state to 'recording', stop() fires ondataavailable
 * synchronously then onstop.
 */
function installMockMediaRecorder() {
  return () => {
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
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null

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
  }
}

/** Standard task detail fixture used across all voice-note tests. */
function makeTaskBody(mechanicNotes: string) {
  return JSON.stringify({
    taskId: '22222222-2222-2222-2222-222222222222',
    taskTitle: 'Oil Change',
    taskStatus: 'IN_PROGRESS',
    mechanicNotes,
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
  })
}

test.describe('Mechanic voice-note diagnostics flow', () => {
  const TASK_ID = '22222222-2222-2222-2222-222222222222'

  test('records voice note, reviews draft, and accepts into diagnostics autosave', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Mechanic')
    let currentNotes = 'Initial typed note'

    await page.addInitScript(installMockMediaRecorder())

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: makeTaskBody(currentNotes),
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

    const diagnosticsTextarea = page.getByPlaceholder(
      DE_WORKSHOP.mechanic.taskDetail.diagnostics.placeholder,
    )
    await expect(diagnosticsTextarea).toHaveValue('Initial typed note')

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.record, 'i') }).click()
    await expect(page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.stop, 'i') })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.stop, 'i') }).click()

    const draftTextarea = page.getByLabel(DE_WORKSHOP.mechanic.taskDetail.voiceNote.draftLabel)
    await expect(draftTextarea).toBeVisible()
    await expect(draftTextarea).toHaveValue('Voice draft from recording')
    await draftTextarea.fill('Edited from voice note')

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/mechanic/tasks/${TASK_ID}/diagnostics`) &&
        response.request().method() === 'PATCH',
    )

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.acceptDraft, 'i') }).click()
    await saveResponsePromise

    await expect(diagnosticsTextarea).toHaveValue('Initial typed note\n\nEdited from voice note')
    await expect(page.getByText(DE_WORKSHOP.mechanic.taskDetail.saveState.saved)).toBeVisible()
  })

  test('discards voice draft without persisting notes', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Mechanic')
    let diagnosticsSaveCalled = false

    await page.addInitScript(installMockMediaRecorder())

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: makeTaskBody('Keep this note'),
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
            text: 'Draft that will be discarded',
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
        diagnosticsSaveCalled = true
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      },
    )

    await corePage.navigate(`/mechanic/tasks/${TASK_ID}`)

    const diagnosticsTextarea = page.getByPlaceholder(
      DE_WORKSHOP.mechanic.taskDetail.diagnostics.placeholder,
    )
    await expect(diagnosticsTextarea).toHaveValue('Keep this note')

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.record, 'i') }).click()
    await expect(page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.stop, 'i') })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.stop, 'i') }).click()

    const draftTextarea = page.getByLabel(DE_WORKSHOP.mechanic.taskDetail.voiceNote.draftLabel)
    await expect(draftTextarea).toBeVisible()
    await expect(draftTextarea).toHaveValue('Draft that will be discarded')

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.discardDraft, 'i') }).click()

    // Draft panel must disappear
    await expect(draftTextarea).not.toBeVisible()

    // Original notes must be unchanged
    await expect(diagnosticsTextarea).toHaveValue('Keep this note')

    // No PATCH to diagnostics must have been triggered
    expect(diagnosticsSaveCalled).toBe(false)

    // Voice-note record button must be available again for a new attempt
    await expect(page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.record, 'i') })).toBeVisible()
  })

  test('shows error state when the provider fails and leaves typed notes intact', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Mechanic')

    await page.addInitScript(installMockMediaRecorder())

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: makeTaskBody('Typed note before failure'),
        })
      },
    )

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}/voice-notes`),
      async (route) => {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Audio processing failed.' }),
        })
      },
    )

    await corePage.navigate(`/mechanic/tasks/${TASK_ID}`)

    const diagnosticsTextarea = page.getByPlaceholder(
      DE_WORKSHOP.mechanic.taskDetail.diagnostics.placeholder,
    )
    await expect(diagnosticsTextarea).toHaveValue('Typed note before failure')

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.record, 'i') }).click()
    await expect(page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.stop, 'i') })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.stop, 'i') }).click()

    // Retry button must appear in the error state
    await expect(
      page.getByRole('button', {
        name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.retry, 'i'),
      }),
    ).toBeVisible()

    // Typed notes must be preserved
    await expect(diagnosticsTextarea).toHaveValue('Typed note before failure')

    // Draft panel must not have appeared
    await expect(
      page.getByLabel(DE_WORKSHOP.mechanic.taskDetail.voiceNote.draftLabel),
    ).not.toBeVisible()

    // Retry must transition back to recording state
    await page
      .getByRole('button', {
        name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.retry, 'i'),
      })
      .click()
    await expect(page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.stop, 'i') })).toBeVisible()
  })

  test('shows friendly guidance when the microphone is missing', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Mechanic')

    await page.addInitScript(installMockMediaRecorder())
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        writable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException('Requested device not found', 'NotFoundError')
          },
        },
      })
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: makeTaskBody('Typed note'),
        })
      },
    )

    await corePage.navigate(`/mechanic/tasks/${TASK_ID}`)

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.record, 'i') }).click()
    await expect(
      page.getByText(DE_WORKSHOP.mechanic.taskDetail.voiceNote.noMicrophone),
    ).toBeVisible()
    await expect(page.getByText('Requested device not found')).not.toBeVisible()
  })

  test('shows friendly guidance when microphone permission is denied', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Mechanic')

    await page.addInitScript(installMockMediaRecorder())
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        writable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException('Permission denied', 'NotAllowedError')
          },
        },
      })
    })

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/mechanic/tasks/${TASK_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: makeTaskBody('Typed note'),
        })
      },
    )

    await corePage.navigate(`/mechanic/tasks/${TASK_ID}`)

    await page.getByRole('button', { name: new RegExp(DE_WORKSHOP.mechanic.taskDetail.voiceNote.record, 'i') }).click()
    await expect(
      page.getByText(DE_WORKSHOP.mechanic.taskDetail.voiceNote.noMicrophone),
    ).toBeVisible()
    await expect(page.getByText('Permission denied')).not.toBeVisible()
  })
})
