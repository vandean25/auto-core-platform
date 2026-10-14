import { resolveApiUrl } from '@/api/client'
import type { components } from '@/api/generated/openapi'

/**
 * Public, unauthenticated API for the estimate approval link. It must not use fetchWithAuth:
 * the page renders outside AuthProvider, and the link token is the only credential.
 */

export type PublicEstimateDecisionRequest = components['schemas']['PublicEstimateDecisionDto']

export interface PublicEstimateTaxBucket {
  rate: string
  net: string
  tax: string
  gross: string
}

export interface PublicEstimateView {
  document: {
    estimate_number: string
    version: number
    issued_at: string
    valid_from: string
    valid_until: string
    validity_days: number
    free_of_charge: boolean
    price_display: 'GROSS' | 'NET_WITH_VAT'
  }
  seller: {
    name: string
    address_street: string | null
    address_zip: string | null
    address_city: string | null
    country_iso: string
    vat_id: string | null
    tax_number: string | null
  }
  customer: {
    type: string
    company_name: string | null
    first_name: string
    last_name: string
    address_street: string | null
    address_zip: string | null
    address_city: string | null
    address_country: string | null
    vat_id: string | null
  }
  vehicle: {
    make: string
    model: string
    plate: string | null
    vin: string | null
    year: number | null
  }
  order: {
    order_number: string
    odometer: number
  }
  lines: Array<{
    type: string
    item_no: string
    description: string
    quantity: string
    unit_price: string
    tax_rate: string
    net: string
    tax: string
    gross: string
  }>
  totals: {
    total_net: string
    total_tax: string
    total_gross: string
    tax_breakdown: PublicEstimateTaxBucket[]
  }
  legal: {
    text_version: string
    text_sha256: string
    paragraphs: string[]
  }
}

export interface PublicEstimateDecisionResult {
  decision: 'APPROVED' | 'DECLINED'
  decided_at: string
}

/** A failed public call. `status` is 0 when the request never reached the server. */
export class PublicEstimateApprovalError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'PublicEstimateApprovalError'
    this.status = status
    this.code = code
  }
}

const NO_SIDE_CHANNEL_INIT: RequestInit = {
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
}

function approvalUrl(token: string): RequestInfo | URL {
  return resolveApiUrl(`/api/public/estimate-approvals/${encodeURIComponent(token)}`)
}

async function request<T>(token: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(approvalUrl(token), { ...NO_SIDE_CHANNEL_INIT, ...init })
  } catch {
    throw new PublicEstimateApprovalError(0, null, 'Network error')
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { code?: unknown; message?: unknown }
    throw new PublicEstimateApprovalError(
      response.status,
      typeof payload.code === 'string' ? payload.code : null,
      typeof payload.message === 'string' ? payload.message : 'Request failed',
    )
  }
  return (await response.json()) as T
}

export function fetchPublicEstimate(token: string, signal?: AbortSignal): Promise<PublicEstimateView> {
  return request<PublicEstimateView>(token, { method: 'GET', headers: { Accept: 'application/json' }, signal })
}

export function submitPublicEstimateDecision(
  token: string,
  body: PublicEstimateDecisionRequest,
): Promise<PublicEstimateDecisionResult> {
  return request<PublicEstimateDecisionResult>(token, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
