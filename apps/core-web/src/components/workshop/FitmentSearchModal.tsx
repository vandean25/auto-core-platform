import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchExternalCatalogSearch,
  useCatalogAssemblyGroups,
} from '@/api/catalog-external'
import type {
  CatalogAssemblyGroupNode,
  CatalogExternalLaborItem,
  CatalogExternalPartsItem,
  CatalogExternalSearchResponse,
  CatalogProviderOemConcern,
  CatalogSearchConcern,
} from '@/api/types'
import { CatalogSourceBanner } from '@/components/workshop/CatalogSourceBanner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency } from '@/lib/utils'
import {
  getFallbackDialogCopy,
  toCatalogSourceMetadata,
  type CatalogSourceMetadata,
} from '@/features/workshop/catalog-source-copy'

const SEARCH_DEBOUNCE_MS = 300

type CatalogApiError = Error & { status?: number }

export interface FitmentSearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workshopOrderId: string
  taskId: string
  vehicleId: string
  oemConcernCode?: CatalogProviderOemConcern['code'] | null
  isIdentityStale: boolean
  onSearchSessionUpdate: (metadata: CatalogSourceMetadata) => void
  onRequestResolveIdentity: () => void
}

interface PendingFallbackState {
  concern: CatalogSearchConcern
  query: string
  fallbackReason: 'EMPTY' | 'ERROR'
}

function flattenAssemblyGroups(
  groups: CatalogAssemblyGroupNode[],
  depth = 0,
): Array<{ id: string; name: string; depth: number }> {
  return groups.flatMap((group) => [
    { id: group.id, name: group.name, depth },
    ...flattenAssemblyGroups(group.children ?? [], depth + 1),
  ])
}

function isPartsItem(
  item: CatalogExternalPartsItem | CatalogExternalLaborItem,
): item is CatalogExternalPartsItem {
  return 'articleNumber' in item
}

export function FitmentSearchModal({
  open,
  onOpenChange,
  workshopOrderId,
  taskId,
  vehicleId,
  oemConcernCode,
  isIdentityStale,
  onSearchSessionUpdate,
  onRequestResolveIdentity,
}: FitmentSearchModalProps) {
  const [activeConcern, setActiveConcern] = useState<CatalogSearchConcern>('PARTS')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [partsResult, setPartsResult] = useState<CatalogExternalSearchResponse | null>(null)
  const [laborResult, setLaborResult] = useState<CatalogExternalSearchResponse | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [pendingFallback, setPendingFallback] = useState<PendingFallbackState | null>(null)
  const [identityConflict, setIdentityConflict] = useState(false)
  const searchGenerationRef = useRef(0)

  const { data: assemblyGroupsData, isFetching: isLoadingAssemblyGroups } =
    useCatalogAssemblyGroups(workshopOrderId, open && activeConcern === 'PARTS' && !isIdentityStale)

  const assemblyGroups = useMemo(
    () => flattenAssemblyGroups(assemblyGroupsData?.groups ?? []),
    [assemblyGroupsData?.groups],
  )

  const activeResult = activeConcern === 'PARTS' ? partsResult : laborResult

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [searchQuery])

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      setDebouncedQuery('')
      setPartsResult(null)
      setLaborResult(null)
      setPendingFallback(null)
      setIdentityConflict(false)
      setActiveConcern('PARTS')
    }
  }, [open])

  const applySearchResult = useCallback(
    (concern: CatalogSearchConcern, response: CatalogExternalSearchResponse) => {
      if (concern === 'PARTS') {
        setPartsResult(response)
      } else {
        setLaborResult(response)
      }
      onSearchSessionUpdate(toCatalogSourceMetadata(concern, response))
    },
    [onSearchSessionUpdate],
  )

  const clearConcernResult = useCallback((concern: CatalogSearchConcern) => {
    if (concern === 'PARTS') {
      setPartsResult(null)
    } else {
      setLaborResult(null)
    }
  }, [])

  const runSearch = useCallback(
    async (params: {
      concern: CatalogSearchConcern
      query: string
      source?: 'AUTO' | 'AFTERMARKET'
      confirmFallback?: boolean
    }) => {
      if (isIdentityStale) {
        setIdentityConflict(true)
        return
      }

      const generation = ++searchGenerationRef.current
      clearConcernResult(params.concern)
      setPendingFallback(null)
      setIsSearching(true)
      setIdentityConflict(false)
      try {
        const response = await fetchExternalCatalogSearch({
          workshopOrderId,
          concern: params.concern,
          q: params.query,
          source: params.source ?? 'AUTO',
          confirmFallback: params.confirmFallback ?? false,
        })

        if (generation !== searchGenerationRef.current) {
          return
        }

        if (response.fallbackRequired && !params.confirmFallback) {
          clearConcernResult(params.concern)
          const fallbackReason = response.fallbackReason ?? 'EMPTY'
          setPendingFallback({
            concern: params.concern,
            query: params.query,
            fallbackReason,
          })
          return
        }

        applySearchResult(params.concern, response)
      } catch (error: unknown) {
        if (generation !== searchGenerationRef.current) {
          return
        }
        const apiError = error as CatalogApiError
        if (apiError.status === 409) {
          clearConcernResult(params.concern)
          setIdentityConflict(true)
          toast.error('Vehicle identity is stale. Re-resolve before searching.')
          return
        }
        toast.error(apiError.message || 'Failed to search catalog')
      } finally {
        if (generation === searchGenerationRef.current) {
          setIsSearching(false)
        }
      }
    },
    [applySearchResult, clearConcernResult, isIdentityStale, workshopOrderId],
  )

  useEffect(() => {
    if (!open || isIdentityStale || debouncedQuery.length === 0) return
    void runSearch({ concern: activeConcern, query: debouncedQuery })
  }, [activeConcern, debouncedQuery, open, isIdentityStale, runSearch])

  async function handleConfirmFallback() {
    if (!pendingFallback) return
    const pending = pendingFallback
    setPendingFallback(null)
    await runSearch({
      concern: pending.concern,
      query: pending.query,
      confirmFallback: true,
    })
  }

  async function handleSearchOtherSource() {
    if (!activeResult || activeResult.sourceUsed !== 'OEM') return
    await runSearch({
      concern: activeConcern,
      query: debouncedQuery,
      source: 'AFTERMARKET',
    })
  }

  function handleAssemblyGroupSelect(groupName: string) {
    setSearchQuery(groupName)
  }

  const canSearchOtherSource =
    activeResult?.sourceUsed === 'OEM' &&
    activeResult.oemStatus === 'HIT' &&
    !isSearching

  const fallbackDialogCopy = pendingFallback
    ? getFallbackDialogCopy(pendingFallback.fallbackReason)
    : null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl'>
          <DialogHeader className='space-y-3 border-b px-6 py-4'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
              <div className='space-y-1 pr-8'>
                <DialogTitle>Fitment catalog search</DialogTitle>
                <DialogDescription>
                  Search OEM and aftermarket catalogs for this vehicle. Results are preview-only in M1.
                </DialogDescription>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {canSearchOtherSource && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => void handleSearchOtherSource()}
                    data-testid='search-other-source-button'
                  >
                    Search other source
                  </Button>
                )}
              </div>
            </div>
            {activeResult && (
              <CatalogSourceBanner
                metadata={toCatalogSourceMetadata(activeConcern, activeResult)}
                oemConcernCode={oemConcernCode}
              />
            )}
          </DialogHeader>

          {(isIdentityStale || identityConflict) && (
            <div className='border-b bg-amber-50 px-6 py-3 text-sm text-amber-900'>
              Vehicle identity is stale or missing. Re-resolve the VIN before searching fitment catalogs.
              <Button
                type='button'
                variant='link'
                className='h-auto px-2 text-amber-900'
                onClick={onRequestResolveIdentity}
              >
                Re-resolve now
              </Button>
            </div>
          )}

          <Tabs
            value={activeConcern}
            onValueChange={(value) => setActiveConcern(value as CatalogSearchConcern)}
            className='flex min-h-0 flex-1 flex-col'
          >
            <div className='border-b px-6 pt-4'>
              <TabsList>
                <TabsTrigger value='PARTS'>Parts</TabsTrigger>
                <TabsTrigger value='LABOR'>Labor</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value='PARTS' className='mt-0 flex min-h-0 flex-1 flex-col'>
              <FitmentSearchPanel
                concern='PARTS'
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                result={partsResult}
                isSearching={isSearching}
                assemblyGroups={assemblyGroups}
                isLoadingAssemblyGroups={isLoadingAssemblyGroups}
                onAssemblyGroupSelect={handleAssemblyGroupSelect}
              />
            </TabsContent>

            <TabsContent value='LABOR' className='mt-0 flex min-h-0 flex-1 flex-col'>
              <FitmentSearchPanel
                concern='LABOR'
                searchQuery={searchQuery}
                onSearchQueryChange={setSearchQuery}
                result={laborResult}
                isSearching={isSearching}
              />
            </TabsContent>
          </Tabs>

          <div className='border-t px-6 py-3 text-xs text-muted-foreground'>
            Task {taskId.slice(0, 8)} · Vehicle {vehicleId.slice(0, 8)} · No add-to-order in M1
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingFallback !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingFallback(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fallbackDialogCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{fallbackDialogCopy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmFallback()}>
              Search aftermarket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface FitmentSearchPanelProps {
  concern: CatalogSearchConcern
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  result: CatalogExternalSearchResponse | null
  isSearching: boolean
  assemblyGroups?: Array<{ id: string; name: string; depth: number }>
  isLoadingAssemblyGroups?: boolean
  onAssemblyGroupSelect?: (groupName: string) => void
}

function FitmentSearchPanel({
  concern,
  searchQuery,
  onSearchQueryChange,
  result,
  isSearching,
  assemblyGroups = [],
  isLoadingAssemblyGroups = false,
  onAssemblyGroupSelect,
}: FitmentSearchPanelProps) {
  const showAssemblyGroups = concern === 'PARTS'

  return (
    <div className='flex min-h-[420px] flex-1 flex-col lg:flex-row'>
      {showAssemblyGroups && (
        <div className='border-b lg:w-56 lg:border-b-0 lg:border-r'>
          <div className='px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            Assembly groups
          </div>
          <ScrollArea className='h-48 lg:h-[360px]'>
            <div className='space-y-1 px-2 pb-3'>
              {isLoadingAssemblyGroups && (
                <div className='flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  Loading groups...
                </div>
              )}
              {!isLoadingAssemblyGroups && assemblyGroups.length === 0 && (
                <p className='px-2 py-2 text-xs text-muted-foreground'>No assembly groups available.</p>
              )}
              {assemblyGroups.map((group) => (
                <button
                  key={group.id}
                  type='button'
                  className='block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent'
                  style={{ paddingLeft: `${8 + group.depth * 12}px` }}
                  onClick={() => onAssemblyGroupSelect?.(group.name)}
                >
                  {group.name}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='border-b px-4 py-3'>
          <div className='relative'>
            <Search className='pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder={`Search ${concern === 'PARTS' ? 'parts' : 'labor'} by number or description...`}
              className='pl-8'
              data-testid={`fitment-search-input-${concern.toLowerCase()}`}
            />
          </div>
        </div>

        <ScrollArea className='flex-1'>
          <div className='space-y-2 p-4'>
            {isSearching && (
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' />
                Searching catalog...
              </div>
            )}

            {!isSearching && result && result.items.length === 0 && (
              <p className='text-sm text-muted-foreground'>No catalog results for this search.</p>
            )}

            {!isSearching &&
              result?.items.map((item) =>
                isPartsItem(item) ? (
                  <div
                    key={`${item.sourceSystem}-${item.externalId}`}
                    className='rounded-lg border px-3 py-2'
                    data-testid='fitment-search-parts-result'
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <div className='text-sm font-medium'>{item.name}</div>
                        <div className='text-xs text-muted-foreground'>
                          {item.articleNumber} · {item.brandLabel}
                        </div>
                        {item.oemNumbers && item.oemNumbers.length > 0 && (
                          <div className='mt-1 text-xs text-muted-foreground'>
                            OEM {item.oemNumbers.join(', ')}
                          </div>
                        )}
                      </div>
                      <div className='shrink-0 text-right text-sm'>
                        {formatCurrency(item.unitPrice)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={`${item.sourceSystem}-${item.externalId}`}
                    className='rounded-lg border px-3 py-2'
                    data-testid='fitment-search-labor-result'
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <div className='text-sm font-medium'>{item.name}</div>
                        <div className='text-xs text-muted-foreground'>
                          {item.externalOperationCode}
                        </div>
                      </div>
                      <Badge variant='outline'>
                        {item.standardAw != null ? `${item.standardAw} AW` : 'Labor'}
                      </Badge>
                    </div>
                  </div>
                ),
              )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
