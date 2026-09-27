import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateAndDownloadInvoicePdf } from './invoices'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

import { fetchWithAuth } from './client'

const asMock = (fn: typeof fetchWithAuth) => fn as ReturnType<typeof vi.fn>

describe('generateAndDownloadInvoicePdf', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('polls GET pdf after enqueued POST until PDF is ready', async () => {
    vi.useFakeTimers()
    const invoiceId = 'inv-1'

    asMock(fetchWithAuth).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/pdf') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ mode: 'enqueued', invoiceId }),
        }
      }
      if (url.endsWith('/pdf') && init?.headers) {
        return {
          ok: true,
          blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
        }
      }
      if (url.endsWith(`/api/sales/invoices/${invoiceId}`)) {
        return {
          ok: true,
          json: async () => ({ pdf_generation_error: null }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const blob = await generateAndDownloadInvoicePdf(invoiceId)
    expect(blob.type).toBe('application/pdf')
    expect(asMock(fetchWithAuth)).toHaveBeenCalled()
  })

  it('surfaces pdf_generation_error from invoice detail during polling', async () => {
    const invoiceId = 'inv-2'

    asMock(fetchWithAuth).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/pdf') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ mode: 'enqueued', invoiceId }),
        }
      }
      if (url.endsWith('/pdf')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ message: 'Invoice PDF is not generated yet' }),
        }
      }
      if (url.endsWith(`/api/sales/invoices/${invoiceId}`)) {
        return {
          ok: true,
          json: async () => ({ pdf_generation_error: 'Renderer failed' }),
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    await expect(generateAndDownloadInvoicePdf(invoiceId)).rejects.toThrow(
      'Renderer failed',
    )
  })
})
