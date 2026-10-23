import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { SearchGroup, SearchResult } from '@/api/search'
import type { MeSite } from '@/api/sites'
import { Badge } from '@/components/ui/badge'
import { CommandEmpty, CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command'
import { Skeleton } from '@/components/ui/skeleton'
import { i18n } from '@/lib/i18n'
import type { RecentSearchItem } from './global-search-recent'
import { getSearchPrefixes, SEARCH_TYPE_REGISTRY } from './global-search-types'

const SKELETON_ROWS = 3

function ResultRow({
  item,
  value,
  badge,
  onSelect,
  children,
}: {
  item: RecentSearchItem
  value: string
  badge?: string | null
  onSelect: (item: RecentSearchItem) => void
  children?: ReactNode
}) {
  const Icon = SEARCH_TYPE_REGISTRY[item.type].icon

  return (
    <CommandItem value={value} onSelect={() => onSelect(item)}>
      <Icon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{item.title}</span>
        {item.subtitle ? <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span> : null}
      </div>
      {badge ? (
        <Badge variant="outline" className="ml-2 shrink-0 font-normal">
          {badge}
        </Badge>
      ) : null}
      {children}
    </CommandItem>
  )
}

export function SearchResultGroup({
  group,
  activeSiteId,
  siteNames,
  onSelect,
}: {
  group: SearchGroup
  activeSiteId: string | null
  siteNames: ReadonlyMap<string, string>
  onSelect: (result: SearchResult) => void
}) {
  const { t } = useTranslation('nav')
  if (group.results.length === 0 && !group.error) return null

  const siteBadge = (result: SearchResult) =>
    result.siteId && result.siteId !== activeSiteId
      ? (siteNames.get(result.siteId) ?? t('globalSearch.otherSite'))
      : null

  return (
    <CommandGroup heading={i18n.t(SEARCH_TYPE_REGISTRY[group.type].labelKey)}>
      {group.error ? (
        <p role="status" className="px-2 py-2 text-xs text-slate-500">
          {t('globalSearch.groupUnavailable')}
        </p>
      ) : null}
      {group.results.map((result) => (
        <ResultRow
          key={`${result.type}:${result.id}`}
          item={result}
          value={`${result.type}:${result.id}`}
          badge={siteBadge(result)}
          onSelect={() => onSelect(result)}
        />
      ))}
    </CommandGroup>
  )
}

export function RecentItemsGroup({
  items,
  onSelect,
  onRemove,
}: {
  items: RecentSearchItem[]
  onSelect: (item: RecentSearchItem) => void
  onRemove: (item: RecentSearchItem) => void
}) {
  const { t } = useTranslation('nav')
  if (items.length === 0) return null

  return (
    <CommandGroup heading={t('globalSearch.recent')}>
      {items.map((item) => (
        <ResultRow key={`${item.type}:${item.id}`} item={item} value={`recent:${item.type}:${item.id}`} onSelect={onSelect}>
          <button
            type="button"
            aria-label={t('globalSearch.removeRecent', { title: item.title })}
            className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-slate-100 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              onRemove(item)
            }}
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        </ResultRow>
      ))}
    </CommandGroup>
  )
}

function SearchSkeletonRows() {
  const { t } = useTranslation('common')

  return (
    <div role="status" aria-busy="true" className="space-y-3 px-3 py-3">
      <span className="sr-only">{t('shell.loading')}</span>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function PrefixHelp() {
  const { t } = useTranslation('nav')

  return (
    <div className="px-3 py-2 text-xs text-slate-500">
      <p className="font-medium">{t('globalSearch.prefixHelp')}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {getSearchPrefixes().map(({ prefix, type }) => (
          <li key={prefix}>
            <code className="rounded bg-slate-100 px-1">{prefix}:</code> {i18n.t(SEARCH_TYPE_REGISTRY[type].labelKey)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Everything under the input once the user has typed: loading, a failed request, per-type groups or "no match". */
export function SearchResults({
  groups,
  isLoading,
  error,
  hasSections,
  activeSiteId,
  sites,
  query,
  onSelect,
}: {
  groups: SearchGroup[]
  isLoading: boolean
  error: Error | null
  hasSections: boolean
  activeSiteId: string | null
  sites: MeSite[]
  query: string
  onSelect: (result: SearchResult) => void
}) {
  const { t } = useTranslation('nav')
  const siteNames = new Map(sites.map((site) => [site.id, site.name]))
  const hasGroups = groups.some((group) => group.results.length > 0 || group.error)
  const isEmpty = !hasGroups && !hasSections && !isLoading && !error

  return (
    <>
      {isEmpty ? (
        <CommandEmpty>
          <p>{t('globalSearch.emptyNoMatch', { query })}</p>
          <p className="mt-1 text-xs text-slate-500">{t('globalSearch.emptyHint')}</p>
        </CommandEmpty>
      ) : null}
      {error ? <div className="px-2 py-6 text-sm text-destructive">{t('globalSearch.unavailable')}</div> : null}
      {isLoading ? <SearchSkeletonRows /> : null}
      {groups.map((group) => (
        <SearchResultGroup
          key={group.type}
          group={group}
          activeSiteId={activeSiteId}
          siteNames={siteNames}
          onSelect={onSelect}
        />
      ))}
      {hasGroups || isLoading || error ? <CommandSeparator /> : null}
    </>
  )
}
