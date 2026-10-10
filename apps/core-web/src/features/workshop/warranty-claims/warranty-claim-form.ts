import type {
  UpdateWarrantyClaimPayload,
  WarrantyClaim,
  WarrantyClaimLine,
  WarrantyClaimStatus,
  WarrantyClaimType,
  WorkshopLineItemType,
  WorkshopTask,
} from '@/api/types'

export const WARRANTY_CLAIM_TYPE_OPTIONS: ReadonlyArray<{ value: WarrantyClaimType; label: string }> = [
  { value: 'GARANTIE', label: 'Garantie' },
  { value: 'KULANZ', label: 'Kulanz' },
  { value: 'GEWAEHRLEISTUNG', label: 'Gewährleistung' },
]

export const WARRANTY_CLAIM_STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: WarrantyClaimStatus | 'all'
  label: string
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED_EXTERNALLY', label: 'Submitted externally' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CLOSED', label: 'Closed' },
]

/** Same look as the other multi-line inputs in the workshop UI. */
export const TEXTAREA_CLASS_NAME =
  'flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

const TYPE_LABELS: Record<WarrantyClaimType, string> = Object.fromEntries(
  WARRANTY_CLAIM_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<WarrantyClaimType, string>

const TYPE_FILE_SLUGS: Record<WarrantyClaimType, string> = {
  GARANTIE: 'garantie',
  KULANZ: 'kulanz',
  GEWAEHRLEISTUNG: 'gewaehrleistung',
}

/** Status changes the backend accepts from each status. Mirrors the transition table on the API. */
export function availableStatusChanges(
  status: WarrantyClaimStatus,
): ReadonlyArray<Exclude<WarrantyClaimStatus, 'DRAFT'>> {
  switch (status) {
    case 'DRAFT':
      return ['SUBMITTED_EXTERNALLY', 'CLOSED']
    case 'SUBMITTED_EXTERNALLY':
      return ['APPROVED', 'REJECTED', 'CLOSED']
    case 'APPROVED':
    case 'REJECTED':
      return ['CLOSED']
    case 'CLOSED':
      return []
  }
}

export function warrantyClaimTypeLabel(type: WarrantyClaimType): string {
  return TYPE_LABELS[type]
}

/** Only DRAFT content is editable. Reference and decision fields stay editable until CLOSED. */
export function isWarrantyClaimContentEditable(status: WarrantyClaimStatus): boolean {
  return status === 'DRAFT'
}

export function isWarrantyClaimMetadataEditable(status: WarrantyClaimStatus): boolean {
  return status !== 'CLOSED'
}

export type WarrantyClaimDraft = {
  type: WarrantyClaimType
  complaint: string
  causeCorrection: string
  claimedAmount: string
  lineItemIds: string[]
  externalReference: string
  decisionDate: string
  decisionNote: string
}

export function draftFromClaim(claim: WarrantyClaim): WarrantyClaimDraft {
  return {
    type: claim.type,
    complaint: claim.complaint ?? '',
    causeCorrection: claim.causeCorrection ?? '',
    claimedAmount: claim.claimedAmountNet ?? '',
    lineItemIds: claim.lines.map((line) => line.workshopTaskLineItemId),
    externalReference: claim.externalReference ?? '',
    decisionDate: claim.decisionDate ?? '',
    decisionNote: claim.decisionNote ?? '',
  }
}

export type ParsedAmount = { valid: boolean; value: number | null }

/** Parses an amount typed as `1250`, `1250.5`, `1.250,50` or `1250,50`. Blank input means no amount. */
export function parseClaimedAmount(raw: string): ParsedAmount {
  const cleaned = raw.trim().replace(/\s/g, '')
  if (cleaned === '') return { valid: true, value: null }

  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return { valid: false, value: null }

  const value = Number(normalized)
  if (value > 1_000_000) return { valid: false, value: null }
  return { valid: true, value }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const others = new Set(b)
  return a.every((id) => others.has(id))
}

/**
 * The autosave payload: only the fields that differ from the last saved draft. An amount that does
 * not parse is left out until it is fixed. Returns null when nothing needs saving.
 */
export function buildClaimPatch(
  saved: WarrantyClaimDraft,
  next: WarrantyClaimDraft,
): UpdateWarrantyClaimPayload | null {
  const payload: UpdateWarrantyClaimPayload = {}

  if (next.type !== saved.type) payload.type = next.type
  if (next.complaint !== saved.complaint) payload.complaint = blankToNull(next.complaint)
  if (next.causeCorrection !== saved.causeCorrection) {
    payload.causeCorrection = blankToNull(next.causeCorrection)
  }
  if (next.claimedAmount !== saved.claimedAmount) {
    const amount = parseClaimedAmount(next.claimedAmount)
    if (amount.valid) payload.claimedAmountNet = amount.value
  }
  if (!sameIds(next.lineItemIds, saved.lineItemIds)) payload.lineItemIds = next.lineItemIds
  if (next.externalReference !== saved.externalReference) {
    payload.externalReference = blankToNull(next.externalReference)
  }
  if (next.decisionDate !== saved.decisionDate) payload.decisionDate = next.decisionDate || null
  if (next.decisionNote !== saved.decisionNote) payload.decisionNote = blankToNull(next.decisionNote)

  return Object.keys(payload).length > 0 ? payload : null
}

/** Euro amount to whole cents, for a value the API sent with two decimals. */
export function toCents(value: string | number): number {
  return Math.round(Number(value) * 100)
}

/**
 * Net amount of one line in whole cents, rounded half up, computed in integers so that no float
 * error creeps in. Quantity has at most 3 decimals and unit price at most 2, as on the API.
 */
export function lineNetCents(quantity: number, unitPrice: number): number {
  const quantityMilli = Math.round(quantity * 1000)
  const priceCents = Math.round(unitPrice * 100)
  return Math.floor((quantityMilli * priceCents + 500) / 1000)
}

/**
 * One row of the line picker. Lines already on the claim show the snapshot the API stored for them.
 * Lines that are not on the claim show the current order values. Cancelled lines appear only when
 * they are on the claim, so they can be removed.
 */
export type ClaimLineRow = {
  id: string
  type: WorkshopLineItemType
  itemNo: string
  description: string
  taskTitle: string
  quantity: number
  unitPrice: number
  netCents: number
  attached: boolean
  cancelledOnOrder: boolean
}

export function buildClaimLineRows(
  tasks: readonly WorkshopTask[] | undefined,
  attachedLines: readonly WarrantyClaimLine[],
): ClaimLineRow[] {
  const attachedById = new Map(attachedLines.map((line) => [line.workshopTaskLineItemId, line]))
  const rows: ClaimLineRow[] = []
  const listed = new Set<string>()

  for (const task of tasks ?? []) {
    for (const item of task.lineItems ?? []) {
      const attached = attachedById.get(item.id)
      const cancelledOnOrder = item.partExecutionStatus === 'CANCELLED'
      if (!attached && cancelledOnOrder) continue
      listed.add(item.id)

      if (attached) {
        rows.push({
          id: item.id,
          type: attached.lineType,
          itemNo: attached.itemNo,
          description: attached.description,
          taskTitle: task.title,
          quantity: Number(attached.quantity),
          unitPrice: Number(attached.unitPrice),
          netCents: toCents(attached.netAmount),
          attached: true,
          cancelledOnOrder,
        })
      } else {
        rows.push({
          id: item.id,
          type: item.type,
          itemNo: item.itemNo,
          description: item.description,
          taskTitle: task.title,
          quantity: item.qty,
          unitPrice: item.unitPrice,
          netCents: lineNetCents(item.qty, item.unitPrice),
          attached: false,
          cancelledOnOrder: false,
        })
      }
    }
  }

  // A claim line whose order line is no longer listed stays visible, so it can still be removed.
  for (const line of attachedLines) {
    if (listed.has(line.workshopTaskLineItemId)) continue
    rows.push({
      id: line.workshopTaskLineItemId,
      type: line.lineType,
      itemNo: line.itemNo,
      description: line.description,
      taskTitle: '',
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      netCents: toCents(line.netAmount),
      attached: true,
      cancelledOnOrder: false,
    })
  }

  return rows
}

/** Sum of the selected rows in cents. This is what the API stores, so the total shown matches it. */
export function selectedNetCents(rows: readonly ClaimLineRow[], selectedIds: readonly string[]): number {
  const selected = new Set(selectedIds)
  return rows.filter((row) => selected.has(row.id)).reduce((sum, row) => sum + row.netCents, 0)
}

/** Client-side hint for the submit button. The API applies the same rule and is authoritative. */
export function canSubmitClaim(draft: WarrantyClaimDraft): boolean {
  const amount = parseClaimedAmount(draft.claimedAmount)
  return (
    draft.complaint.trim() !== '' &&
    amount.valid &&
    amount.value !== null &&
    amount.value > 0 &&
    draft.lineItemIds.length > 0
  )
}

/** Euro amount in German notation, for example `1.250,00 €`. Missing values show a dash. */
export function formatEur(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '–'
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return '–'
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric)
}

/** File name the API uses for the claim PDF, so a client download matches a direct one. */
export function warrantyClaimPdfFileName(claim: Pick<WarrantyClaim, 'id' | 'type'>, orderNumber: string): string {
  const orderSlug = orderNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'order'
  return `${TYPE_FILE_SLUGS[claim.type]}-${orderSlug}-${claim.id.slice(0, 8)}.pdf`
}
