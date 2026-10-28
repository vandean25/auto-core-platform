import type { WorkshopEstimateListFilters, WorkshopEstimateStatus } from '@/api/workshop-estimates'

/** Statuses with a chip. SUPERSEDED has its own switch, because it is the history, not a state to work on. */
export const ESTIMATE_STATUS_CHIPS = ['SENT', 'APPROVED', 'DECLINED', 'EXPIRED', 'DRAFT'] as const satisfies readonly WorkshopEstimateStatus[]

export type EstimateStatusChip = (typeof ESTIMATE_STATUS_CHIPS)[number] | 'ALL'

export const DEFAULT_ESTIMATE_STATUS: EstimateStatusChip = 'SENT'

/** What the filter bar shows. It lives in the URL, so a reload or a shared link keeps the view. */
export type EstimateListView = {
  status: EstimateStatusChip
  showOlder: boolean
  customerId: string
  customerName: string
  sentFrom: string
  sentTo: string
}

const VIEW_PARAMS = ['status', 'older', 'customerId', 'customerName', 'sentFrom', 'sentTo'] as const

function isStatusChip(value: string | null): value is EstimateStatusChip {
  return value === 'ALL' || ESTIMATE_STATUS_CHIPS.some((chip) => chip === value)
}

export function parseEstimateListView(params: URLSearchParams): EstimateListView {
  const status = params.get('status')
  return {
    status: isStatusChip(status) ? status : DEFAULT_ESTIMATE_STATUS,
    showOlder: params.get('older') === '1',
    customerId: params.get('customerId') ?? '',
    customerName: params.get('customerName') ?? '',
    sentFrom: params.get('sentFrom') ?? '',
    sentTo: params.get('sentTo') ?? '',
  }
}

/** Writes the view into a copy of the params; defaults stay out of the URL and other params are kept. */
export function writeEstimateListView(params: URLSearchParams, view: EstimateListView): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of VIEW_PARAMS) {
    next.delete(key)
  }
  if (view.status !== DEFAULT_ESTIMATE_STATUS) next.set('status', view.status)
  if (view.showOlder) next.set('older', '1')
  if (view.customerId) {
    next.set('customerId', view.customerId)
    next.set('customerName', view.customerName)
  }
  if (view.sentFrom) next.set('sentFrom', view.sentFrom)
  if (view.sentTo) next.set('sentTo', view.sentTo)
  return next
}

/** The API takes the sent range only as a pair, from not after to. */
export function isSentRangeComplete(view: Pick<EstimateListView, 'sentFrom' | 'sentTo'>): boolean {
  return Boolean(view.sentFrom && view.sentTo && view.sentFrom <= view.sentTo)
}

export function hasInvalidSentRange(view: Pick<EstimateListView, 'sentFrom' | 'sentTo'>): boolean {
  return Boolean(view.sentFrom || view.sentTo) && !isSentRangeComplete(view)
}

/** Without a status the API hides SUPERSEDED, so the switch sets that status explicitly. */
export function toEstimateApiFilters(view: EstimateListView): WorkshopEstimateListFilters {
  const filters: WorkshopEstimateListFilters = {}
  if (view.showOlder) {
    filters.status = 'SUPERSEDED'
  } else if (view.status !== 'ALL') {
    filters.status = view.status
  }
  if (view.customerId) filters.customerId = view.customerId
  if (isSentRangeComplete(view)) {
    filters.sentFrom = view.sentFrom
    filters.sentTo = view.sentTo
  }
  return filters
}
