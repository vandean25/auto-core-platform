import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'
import { inventoryKeys, type InventoryItemDetail } from './inventory'
import type { InventoryItem } from './types'
import { generateUuidV7 } from '@/lib/id'

export type InventoryPriceOperationDto = components['schemas']['InventoryPriceOperationDto']
export type InventoryPriceOperationListResponseDto = components['schemas']['InventoryPriceOperationListResponseDto']

export const GUARDED_PRICE_LEASE_MS = 2 * 60 * 1000
const BULK_PRICE_CONCURRENCY = 5
const INTENTS_STORAGE_KEY = 'acp.inventory.priceOps.intents.v1'
const SEEN_STORAGE_KEY = 'acp.inventory.priceOps.seen.v1'
const INTENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export const priceOpsKeys = {
  all: ['inventory', 'price-operations'] as const,
  discovery: () => [...priceOpsKeys.all, 'discovery'] as const,
}

export type PreviewReadyItem = {
  itemId: string
  sku: string
  name: string
  basisPrice: number
  targetPrice: number
  targetMinorUnits: number
  expectedRevision: number
}

export type PreviewReadFailure = {
  itemId: string
  sku: string
  name: string
  status: 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID'
}

export type PreviewPriceResult = {
  ready: PreviewReadyItem[]
  failed: PreviewReadFailure[]
}

export type FrozenGuardedPriceIntent = PreviewReadyItem & {
  key: string
  createdAt: number
}

export type GuardedPriceItemStatus =
  | 'APPLIED'
  | 'CONFLICT'
  | 'PENDING'
  | 'UNRESOLVED'
  | 'FENCED'
  | 'OUTCOME_UNAVAILABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID'

export type GuardedPriceItemOutcome = {
  key: string
  itemId: string
  sku: string
  name: string
  basisPrice: number
  targetPrice: number
  expectedRevision: number
  status: GuardedPriceItemStatus
  acceptedAt: string | null
}

function readStorageJson<T>(storageKey: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStorageJson(storageKey: string, value: unknown): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Convenience storage only; ignore quota or restricted storage errors.
  }
}

export function loadFrozenIntents(): Record<string, FrozenGuardedPriceIntent> {
  const stored = readStorageJson<Record<string, FrozenGuardedPriceIntent>>(INTENTS_STORAGE_KEY, {})
  const cutoff = Date.now() - INTENT_MAX_AGE_MS
  const fresh: Record<string, FrozenGuardedPriceIntent> = {}
  for (const [key, intent] of Object.entries(stored)) {
    if (intent && typeof intent.createdAt === 'number' && intent.createdAt >= cutoff) {
      fresh[key] = intent
    }
  }
  return fresh
}

export function saveFrozenIntents(intents: FrozenGuardedPriceIntent[]): void {
  const existing = loadFrozenIntents()
  for (const intent of intents) {
    existing[intent.key] = intent
  }
  writeStorageJson(INTENTS_STORAGE_KEY, existing)
}

export function removeFrozenIntents(keys: string[]): void {
  if (keys.length === 0) return
  const existing = loadFrozenIntents()
  for (const key of keys) {
    delete existing[key]
  }
  writeStorageJson(INTENTS_STORAGE_KEY, existing)
}

export function getSeenPriceOperationKeys(): Set<string> {
  const list = readStorageJson<string[]>(SEEN_STORAGE_KEY, [])
  return new Set(Array.isArray(list) ? list : [])
}

export function markPriceOperationsSeen(keys: string[]): void {
  if (keys.length === 0) return
  const seen = getSeenPriceOperationKeys()
  for (const key of keys) {
    seen.add(key)
  }
  writeStorageJson(SEEN_STORAGE_KEY, Array.from(seen).slice(-500))
}

export function classifyAcceptedOperation(acceptedAtIso: string | null, now = Date.now()): 'PENDING' | 'UNRESOLVED' {
  if (!acceptedAtIso) return 'PENDING'
  const parsed = Date.parse(acceptedAtIso)
  if (!Number.isFinite(parsed)) return 'PENDING'
  return now - parsed >= GUARDED_PRICE_LEASE_MS ? 'UNRESOLVED' : 'PENDING'
}

export function mapOperationDtoToStatus(op: InventoryPriceOperationDto, now = Date.now()): GuardedPriceItemStatus {
  if (op.state === 'APPLIED') return 'APPLIED'
  if (op.state === 'CONFLICT') return 'CONFLICT'
  if (op.state === 'FENCED') return 'FENCED'
  return classifyAcceptedOperation(op.acceptedAt, now)
}

export function isDefiniteFailureStatus(status: GuardedPriceItemStatus): boolean {
  return status === 'FORBIDDEN' || status === 'NOT_FOUND' || status === 'INVALID'
}

export function freezePriceIntents(readyItems: PreviewReadyItem[]): FrozenGuardedPriceIntent[] {
  const createdAt = Date.now()
  const frozen = readyItems.map((item) => ({
    ...item,
    key: generateUuidV7(),
    createdAt,
  }))
  saveFrozenIntents(frozen)
  return frozen
}

async function runInBatches<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let start = 0; start < items.length; start += BULK_PRICE_CONCURRENCY) {
    const batch = await Promise.all(items.slice(start, start + BULK_PRICE_CONCURRENCY).map(worker))
    results.push(...batch)
  }
  return results
}

async function readPreviewItem(
  item: Pick<InventoryItem, 'id' | 'sku' | 'name'>,
  percent: number,
): Promise<{ ok: true; item: PreviewReadyItem } | { ok: false; failure: PreviewReadFailure }> {
  try {
    const response = await fetchWithAuth(`/api/inventory/${item.id}`)
    if (!response.ok) {
      const status = response.status === 403 ? 'FORBIDDEN' : response.status === 404 ? 'NOT_FOUND' : 'INVALID'
      return { ok: false, failure: { itemId: item.id, sku: item.sku, name: item.name, status } }
    }
    const detail = (await response.json()) as InventoryItemDetail
    const targetPrice = Math.round(detail.price * (1 + percent / 100) * 100) / 100
    return {
      ok: true,
      item: {
        itemId: item.id,
        sku: detail.sku || item.sku,
        name: detail.name || item.name,
        basisPrice: detail.price,
        targetPrice,
        targetMinorUnits: Math.round(targetPrice * 100),
        expectedRevision: detail.revision,
      },
    }
  } catch {
    return { ok: false, failure: { itemId: item.id, sku: item.sku, name: item.name, status: 'INVALID' } }
  }
}

async function fetchOperationByKey(key: string): Promise<InventoryPriceOperationDto | null> {
  try {
    const response = await fetchWithAuth(`/api/inventory/price-operations/${key}`)
    if (!response.ok) return null
    return (await response.json()) as InventoryPriceOperationDto
  } catch {
    return null
  }
}

function outcomeFor(intent: FrozenGuardedPriceIntent, status: GuardedPriceItemStatus, acceptedAt: string | null = null): GuardedPriceItemOutcome {
  return {
    key: intent.key,
    itemId: intent.itemId,
    sku: intent.sku,
    name: intent.name,
    basisPrice: intent.basisPrice,
    targetPrice: intent.targetPrice,
    expectedRevision: intent.expectedRevision,
    status,
    acceptedAt,
  }
}

async function resolveUnknownPatchOutcome(intent: FrozenGuardedPriceIntent): Promise<GuardedPriceItemOutcome> {
  const op = await fetchOperationByKey(intent.key)
  if (op) {
    return outcomeFor(intent, mapOperationDtoToStatus(op), op.acceptedAt)
  }
  return outcomeFor(intent, 'OUTCOME_UNAVAILABLE')
}

async function parseErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { code?: unknown }
    return typeof body?.code === 'string' ? body.code : null
  } catch {
    return null
  }
}

const DEFINITE_FAILURE_STATUS_MAP: Record<number, GuardedPriceItemStatus> = {
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  400: 'INVALID',
}

function classifyPatchErrorResponse(status: number, code: string | null): GuardedPriceItemStatus | null {
  if (status === 409) {
    if (code === 'INVENTORY_REVISION_CONFLICT') return 'CONFLICT'
    if (code === 'OPERATION_FENCED') return 'FENCED'
    return null
  }
  if (status === 410 || status === 422) return 'OUTCOME_UNAVAILABLE'
  return DEFINITE_FAILURE_STATUS_MAP[status] ?? null
}

async function executeGuardedPatch(intent: FrozenGuardedPriceIntent): Promise<GuardedPriceItemOutcome> {
  try {
    const response = await fetchWithAuth(`/api/inventory/${intent.itemId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': intent.key,
      },
      body: JSON.stringify({
        retail_price: intent.targetPrice,
        expectedRevision: intent.expectedRevision,
      }),
    })

    if (response.ok) return outcomeFor(intent, 'APPLIED')

    const code = await parseErrorCode(response)
    const classified = classifyPatchErrorResponse(response.status, code)
    return classified ? outcomeFor(intent, classified) : await resolveUnknownPatchOutcome(intent)
  } catch {
    return await resolveUnknownPatchOutcome(intent)
  }
}

export function usePreviewGuardedPriceChanges() {
  return useMutation({
    mutationKey: [...priceOpsKeys.all, 'preview'],
    mutationFn: async ({
      items,
      percent,
    }: {
      items: Pick<InventoryItem, 'id' | 'sku' | 'name'>[]
      percent: number
    }): Promise<PreviewPriceResult> => {
      const results = await runInBatches(items, (item) => readPreviewItem(item, percent))
      const ready: PreviewReadyItem[] = []
      const failed: PreviewReadFailure[] = []
      for (const entry of results) {
        if (entry.ok) ready.push(entry.item)
        else failed.push(entry.failure)
      }
      return { ready, failed }
    },
  })
}

export function useExecuteGuardedPriceChanges() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...priceOpsKeys.all, 'execute'],
    mutationFn: async (intents: FrozenGuardedPriceIntent[]): Promise<GuardedPriceItemOutcome[]> => {
      return await runInBatches(intents, executeGuardedPatch)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
      void queryClient.invalidateQueries({ queryKey: priceOpsKeys.all })
    },
  })
}

export type FenceOperationInput = {
  key: string
  itemId: string
  retail_price: number
  expectedRevision: number
}

export type FenceOperationResult =
  | { outcome: 'OPERATION'; operation: InventoryPriceOperationDto }
  | { outcome: 'OUTCOME_UNAVAILABLE' }
  | { outcome: 'OPERATION_UNRESOLVED' }

export function useFenceInventoryPriceOperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...priceOpsKeys.all, 'fence'],
    mutationFn: async (input: FenceOperationInput): Promise<FenceOperationResult> => {
      const response = await fetchWithAuth(`/api/inventory/price-operations/${input.key}/fence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: input.itemId,
          retail_price: input.retail_price,
          expectedRevision: input.expectedRevision,
        }),
      })
      if (response.ok) {
        const operation = (await response.json()) as InventoryPriceOperationDto
        return { outcome: 'OPERATION', operation }
      }
      const code = await parseErrorCode(response)
      if (response.status === 410 || code === 'OUTCOME_UNAVAILABLE') {
        return { outcome: 'OUTCOME_UNAVAILABLE' }
      }
      if (response.status === 409 && code === 'OPERATION_UNRESOLVED') {
        return { outcome: 'OPERATION_UNRESOLVED' }
      }
      throw new Error(code ?? 'FENCE_FAILED')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: priceOpsKeys.all })
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
    },
  })
}

export function useInventoryPriceOperationsDiscovery(enabled: boolean) {
  return useInfiniteQuery<InventoryPriceOperationListResponseDto>({
    queryKey: priceOpsKeys.discovery(),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()
      if (typeof pageParam === 'string' && pageParam) {
        params.set('cursor', pageParam)
      }
      const qs = params.toString()
      const response = await fetchWithAuth(`/api/inventory/price-operations${qs ? `?${qs}` : ''}`)
      if (!response.ok) {
        throw new Error('Failed to load price operations')
      }
      return (await response.json()) as InventoryPriceOperationListResponseDto
    },
    getNextPageParam: (lastPage) => (lastPage.meta.hasNextPage ? lastPage.meta.nextCursor ?? undefined : undefined),
  })
}
