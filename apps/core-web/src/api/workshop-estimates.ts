import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from '@/api/client'
import type { components } from '@/api/generated/openapi'
import { workshopCommunicationKeys } from '@/api/workshop-communications'

export type WorkshopEstimate = components['schemas']['WorkshopEstimateResponseDto']
export type WorkshopEstimateVersionSummary = components['schemas']['WorkshopEstimateVersionSummaryDto']
export type WorkshopEstimateVersionDetail = components['schemas']['WorkshopEstimateVersionDetailDto']
export type WorkshopEstimateOverrunWarning = components['schemas']['WorkshopEstimateOverrunWarningDto']
export type WorkshopEstimateStatus = WorkshopEstimateVersionSummary['status']
export type WorkshopEstimateListRow = components['schemas']['WorkshopEstimateListRowDto']
export type WorkshopEstimateListPage = components['schemas']['WorkshopEstimateListPageResponseDto']

/** Filters of the estimates list (`GET /workshop/estimates`). A set status wins over the superseded rule of the API. */
export type WorkshopEstimateListFilters = {
  status?: WorkshopEstimateStatus
  customerId?: string
  /** Site-local days as YYYY-MM-DD; the API needs both or none. */
  sentFrom?: string
  sentTo?: string
}

const ESTIMATE_LIST_PAGE_SIZE = 25

const WORKSHOP_API = '/api/workshop'

/** One factory for the estimate domain. Invalidating ['workshop', 'estimates'] refreshes every estimate query. */
export const workshopEstimateKeys = {
  all: ['workshop', 'estimates'] as const,
  lists: () => [...workshopEstimateKeys.all, 'list'] as const,
  list: (filters: WorkshopEstimateListFilters) => [...workshopEstimateKeys.all, 'list', filters] as const,
  order: (orderId: string) => [...workshopEstimateKeys.all, 'order', orderId] as const,
  version: (versionId: string) => [...workshopEstimateKeys.all, 'version', versionId] as const,
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: unknown }
    const message =
      typeof payload.message === 'string' && payload.message.trim() ? payload.message : fallbackMessage
    // `status` and `data` let callers read the structured error code (see getErrorCode).
    throw Object.assign(new Error(message), { status: response.status, data: payload })
  }
  return (await response.json()) as T
}

/** The estimate of a workshop order (one per order, created on demand), or null. */
export async function fetchWorkshopOrderEstimate(orderId: string): Promise<WorkshopEstimate | null> {
  const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/estimates`)
  const list = await readJson<{ data: WorkshopEstimate[] }>(response, 'Kostenvoranschlag konnte nicht geladen werden.')
  return list.data[0] ?? null
}

export async function fetchWorkshopEstimateVersion(versionId: string): Promise<WorkshopEstimateVersionDetail> {
  const response = await fetchWithAuth(`${WORKSHOP_API}/estimates/${versionId}`)
  return readJson<WorkshopEstimateVersionDetail>(response, 'Version konnte nicht geladen werden.')
}

export async function fetchWorkshopEstimateListPage(
  filters: WorkshopEstimateListFilters,
  cursor: string | undefined,
): Promise<WorkshopEstimateListPage> {
  const params = new URLSearchParams({ pageSize: String(ESTIMATE_LIST_PAGE_SIZE) })
  for (const [key, value] of Object.entries({ ...filters, cursor })) {
    if (value) {
      params.set(key, value)
    }
  }
  const response = await fetchWithAuth(`${WORKSHOP_API}/estimates?${params.toString()}`)
  return readJson<WorkshopEstimateListPage>(response, 'Kostenvoranschläge konnten nicht geladen werden.')
}

export function workshopEstimatePdfPath(versionId: string): string {
  return `${WORKSHOP_API}/estimates/${versionId}/pdf`
}

/** Polling check for the async PDF: the safe error text of the last render, or null. */
export async function fetchWorkshopEstimatePdfError(versionId: string): Promise<string | null> {
  const response = await fetchWithAuth(`${WORKSHOP_API}/estimates/${versionId}`)
  if (!response.ok) {
    return null
  }
  const version = (await response.json()) as WorkshopEstimateVersionDetail
  return version.pdf_generation_error ?? null
}

export function workshopEstimatePdfFilename(estimateNumber: string, version: number): string {
  return `kostenvoranschlag-${estimateNumber}-v${version}`.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf'
}

export function useWorkshopOrderEstimate(orderId: string) {
  return useQuery({
    queryKey: workshopEstimateKeys.order(orderId),
    queryFn: () => fetchWorkshopOrderEstimate(orderId),
    enabled: Boolean(orderId),
  })
}

/** Estimates of the active site, newest first, loaded page by page with the cursor of the previous page. */
export function useWorkshopEstimateList(filters: WorkshopEstimateListFilters) {
  return useInfiniteQuery({
    queryKey: workshopEstimateKeys.list(filters),
    queryFn: ({ pageParam }) => fetchWorkshopEstimateListPage(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.next_cursor ?? undefined,
  })
}

/** Full version detail. Used for the live totals of a DRAFT, which the list does not carry. */
export function useWorkshopEstimateVersion(versionId: string | null) {
  return useQuery({
    queryKey: workshopEstimateKeys.version(versionId ?? ''),
    queryFn: () => fetchWorkshopEstimateVersion(versionId as string),
    enabled: Boolean(versionId),
  })
}

/** Every estimate mutation also refreshes the estimates lists, whose rows carry status, sent date and totals. */
function invalidateEstimate(queryClient: ReturnType<typeof useQueryClient>, orderId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.order(orderId) }),
    queryClient.invalidateQueries({ queryKey: workshopCommunicationKeys.order(orderId) }),
  ])
}

export function useCreateWorkshopEstimate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/estimates`, { method: 'POST' })
      return readJson<WorkshopEstimate>(response, 'Kostenvoranschlag konnte nicht erstellt werden.')
    },
    onSuccess: (_estimate, orderId) => invalidateEstimate(queryClient, orderId),
  })
}

/** A revision is a new DRAFT version under the same number. The sent versions stay readable. */
export function useReviseWorkshopEstimate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (orderId: string) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/estimates/revisions`, {
        method: 'POST',
      })
      return readJson<WorkshopEstimateVersionDetail>(response, 'Neue Version konnte nicht erstellt werden.')
    },
    onSuccess: (_version, orderId) => invalidateEstimate(queryClient, orderId),
  })
}

export type SendWorkshopEstimateVersionBody = Partial<components['schemas']['SendWorkshopEstimateVersionDto']>

export function useSendWorkshopEstimateVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      versionId,
      notifyCustomerByEmail,
    }: {
      orderId: string
      versionId: string
      notifyCustomerByEmail?: boolean
    }) => {
      // Without the flag the request has no body: the advisor records the send and nothing is emailed.
      const body: SendWorkshopEstimateVersionBody | null = notifyCustomerByEmail ? { notifyCustomerByEmail: true } : null
      const response = await fetchWithAuth(
        `${WORKSHOP_API}/estimates/${versionId}/send`,
        body
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : { method: 'POST' },
      )
      return readJson<WorkshopEstimateVersionDetail>(response, 'Kostenvoranschlag konnte nicht gesendet werden.')
    },
    onSuccess: (_version, { orderId, versionId }) => {
      void queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.version(versionId) })
      return invalidateEstimate(queryClient, orderId)
    },
  })
}

export type RecordWorkshopEstimateDecisionBody = components['schemas']['RecordWorkshopEstimateDecisionDto']
export type RecordWorkshopOverrunNoticeBody = components['schemas']['RecordWorkshopOverrunNoticeDto']
export type WorkshopOverrunNotice = components['schemas']['WorkshopOverrunNoticeDto']

/** Advisor-recorded decision on a sent version. The version and the order's estimate read again afterwards. */
export function useRecordWorkshopEstimateDecision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      versionId,
      body,
    }: {
      orderId: string
      versionId: string
      body: RecordWorkshopEstimateDecisionBody
    }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/estimates/${versionId}/approve-advisor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return readJson<WorkshopEstimateVersionDetail>(response, 'Bestätigung konnte nicht erfasst werden.')
    },
    onSuccess: (_version, { orderId, versionId }) => {
      void queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.version(versionId) })
      return invalidateEstimate(queryClient, orderId)
    },
  })
}

/** The advisor informed the customer about the overrun of the approved baseline (AUT-355). */
export function useRecordWorkshopOverrunNotice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, body }: { orderId: string; body: RecordWorkshopOverrunNoticeBody }) => {
      const response = await fetchWithAuth(`${WORKSHOP_API}/orders/${orderId}/overrun/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return readJson<WorkshopOverrunNotice>(response, 'Mitteilung an den Kunden konnte nicht erfasst werden.')
    },
    onSuccess: (_notice, { orderId }) => invalidateEstimate(queryClient, orderId),
  })
}
