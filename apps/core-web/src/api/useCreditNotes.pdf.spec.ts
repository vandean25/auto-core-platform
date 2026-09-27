import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAndDownloadCreditNotePdf } from './useCreditNotes'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

import { fetchWithAuth } from './client'

const asMock = (fn: typeof fetchWithAuth) => fn as ReturnType<typeof vi.fn>

describe('generateAndDownloadCreditNotePdf', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('polls GET pdf after enqueued POST until PDF is ready', async () => {
    vi.useFakeTimers()
    const creditNoteId = 'cn-1'

    asMock(fetchWithAuth).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/pdf') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ mode: 'enqueued', creditNoteId }),
        }
      }
      if (url.endsWith('/pdf') && init?.headers) {
        return {
          ok: true,
          blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
        }
      }
      if (url.endsWith(`/api/credit-notes/${creditNoteId}`)) {
        return {
          ok: true,
          json: async () => ({ pdfGenerationError: null }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const blobPromise = generateAndDownloadCreditNotePdf(creditNoteId)
    const blob = await blobPromise
    expect(blob.type).toBe('application/pdf')
    expect(asMock(fetchWithAuth)).toHaveBeenCalled()
  })

  it('surfaces pdfGenerationError from credit note detail during polling', async () => {
    const creditNoteId = 'cn-2'

    asMock(fetchWithAuth).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/pdf') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ mode: 'enqueued', creditNoteId }),
        }
      }
      if (url.endsWith('/pdf')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: 'Credit note PDF is not generated yet' }),
        }
      }
      if (url.endsWith(`/api/credit-notes/${creditNoteId}`)) {
        return {
          ok: true,
          json: async () => ({ pdfGenerationError: 'Renderer failed' }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await expect(generateAndDownloadCreditNotePdf(creditNoteId)).rejects.toThrow(
      'Renderer failed',
    )
  })

  it('does not poll when POST returns cached mode', async () => {
    const creditNoteId = 'cn-cached'
    let pdfGetCalls = 0

    asMock(fetchWithAuth).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/pdf') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ mode: 'cached', creditNoteId }),
        }
      }
      if (url.endsWith('/pdf')) {
        pdfGetCalls += 1
        return {
          ok: true,
          blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const blob = await generateAndDownloadCreditNotePdf(creditNoteId)
    expect(blob.type).toBe('application/pdf')
    expect(pdfGetCalls).toBe(1)
  })
})
