import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PublicEstimateApprovalError,
  fetchPublicEstimate,
  submitPublicEstimateDecision,
} from './public-estimate-approvals'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('public estimate approval API', () => {
  it('reads the estimate with a plain GET, without credentials or an Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: { estimate_number: 'KV-1' } }))

    const view = await fetchPublicEstimate('tok/en 1')

    expect(view.document.estimate_number).toBe('KV-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/public/estimate-approvals/tok%2Fen%201')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('posts the decision as JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ decision: 'APPROVED', decided_at: '2026-10-14T08:00:00.000Z' }))
    const body = {
      decision: 'APPROVE' as const,
      typed_full_name: 'Erika Beispiel',
      legal_blocks_accepted: true,
      b2c_declaration_accepted: true,
    }

    const result = await submitPublicEstimateDecision('tok', body)

    expect(result.decision).toBe('APPROVED')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify(body))
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('raises an error with status and code for a refused request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'ESTIMATE_APPROVAL_UNAVAILABLE', message: 'gone' }, 410))

    await expect(fetchPublicEstimate('tok')).rejects.toMatchObject({
      name: 'PublicEstimateApprovalError',
      status: 410,
      code: 'ESTIMATE_APPROVAL_UNAVAILABLE',
    })
  })

  it('reports status 0 when the network fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const error = await fetchPublicEstimate('tok').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PublicEstimateApprovalError)
    expect((error as PublicEstimateApprovalError).status).toBe(0)
  })
})
