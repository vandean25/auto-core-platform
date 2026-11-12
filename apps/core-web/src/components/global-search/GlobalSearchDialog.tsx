import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MessageSquareText } from 'lucide-react'

import { selectEffectiveCapabilities, useAuthSession } from '@/api/auth-session'
import { useMySites } from '@/api/sites'
import { executeEntityAction } from '@/features/actions/entity-action'
import { useSelectionPaletteSection } from '@/features/actions/selection-palette-store'
import { useSavedViewActions } from '@/features/saved-views/use-saved-view-actions'
import { useGlobalSearch } from '@/hooks/useGlobalSearch'
import { CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LocaleBundleLoadFailed, useLazyNamespaceBundleReady } from '@/lib/i18n'
import { PageLoader } from '@/components/ui/PageLoader'
import { canUseWorkshopCommand } from '@/features/actions/action-role-predicates'
import { WorkshopCommandPanel } from '@/features/workshop-command/WorkshopCommandPanel'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { prefetchMainListRoute, prefetchPermittedMainListRoutes } from '@/app/route-chunk-prefetch'

const GLOBAL_SEARCH_LAZY_NAMESPACES = ['settings', 'workshop', 'customers', 'vehicles', 'sales'] as const
import { GlobalSearchContextActionGroup } from './GlobalSearchContextActionGroup'
import { QuickActionGroup } from './GlobalSearchResultGroups'
import { PrefixHelp, RecentItemsGroup, SearchResults } from './GlobalSearchResultGroupsView'
import {
  filterPaletteContextActions,
  type PaletteContextAction,
  type PaletteContextActionSection,
} from './global-search-context-actions'
import { useGlobalSearchPaletteContext } from './use-global-search-palette-context'
import { truncate } from './global-search-format'
import { getPaletteSections, getSavedViewManageSection } from './global-search-navigation'
import { recentItemsKey, useRecentItems, type RecentSearchItem } from './global-search-recent'

interface GlobalSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type PaletteSubPage = {
  id: string
  heading: string
  items: PaletteContextAction[]
}

function getSessionSearchMeta(session: ReturnType<typeof useAuthSession>['data']) {
  if (!session) return { recentKey: null, roleInfo: null, activeSiteId: null }
  return {
    recentKey: recentItemsKey(session.userId, session.activeTenant.id),
    roleInfo: { platformRole: session.platformRole ?? null, activeRole: session.activeRole, capabilities: selectEffectiveCapabilities(session) },
    activeSiteId: session.activeSiteId ?? null,
  }
}

function navigatePaletteHref(
  href: string,
  inNewTab: boolean,
  navigate: ReturnType<typeof useNavigate>,
) {
  if (inNewTab) {
    window.open(href, '_blank', 'noopener,noreferrer')
    return
  }
  navigate(href)
}

function handlePaletteInputKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  rawSearch: string,
  newTabRef: React.MutableRefObject<boolean>,
  popSubPage: () => boolean,
) {
  if (event.key === 'Enter') {
    newTabRef.current = event.metaKey || event.ctrlKey
    return
  }
  if (event.key === 'Backspace' && !rawSearch && popSubPage()) {
    event.preventDefault()
  }
}

type UsePaletteSubPagesArgs = {
  open: boolean
  query: string
  rootSection: PaletteContextActionSection | null
  defaultPlaceholder: string
  setSearch: (value: string) => void
  onOpenChange: (open: boolean) => void
}

function usePaletteSubPages({
  open,
  query,
  rootSection,
  defaultPlaceholder,
  setSearch,
  onOpenChange,
}: UsePaletteSubPagesArgs) {
  const [subPages, setSubPages] = React.useState<PaletteSubPage[]>([])

  React.useEffect(() => {
    if (!open) {
      setSearch('')
      setSubPages([])
    }
  }, [open, setSearch])

  const activeSubPage = subPages[subPages.length - 1]

  const popSubPage = () => {
    if (!activeSubPage) return false
    setSearch('')
    setSubPages((prev) => prev.slice(0, -1))
    return true
  }

  const runContextAction = (action: PaletteContextAction) => {
    const children = action.children
    if (children?.length) {
      setSearch('')
      setSubPages((prev) => [...prev, { id: action.id, heading: action.label, items: children }])
      return
    }
    setSearch('')
    setSubPages([])
    onOpenChange(false)
    action.onSelect()
  }

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    if (popSubPage()) event.preventDefault()
  }

  const contextSection = activeSubPage
    ? { heading: activeSubPage.heading, items: filterPaletteContextActions(activeSubPage.items, query) }
    : rootSection
  const placeholder = activeSubPage ? activeSubPage.heading : defaultPlaceholder

  return {
    isSubPage: Boolean(activeSubPage),
    contextSection,
    placeholder,
    popSubPage,
    runContextAction,
    handleEscapeKeyDown,
  }
}

function CommandModeDialog({
  open,
  onOpenChange,
  onExit,
  onOpenOrders,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExit: () => void
  onOpenOrders: () => void
}) {
  const { t } = useTranslation('workshop')
  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    event.preventDefault()
    onExit()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl" onEscapeKeyDown={handleEscapeKeyDown}>
        <DialogHeader className="sr-only">
          <DialogTitle className="sr-only">{t('command.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('command.description')}</DialogDescription>
        </DialogHeader>
        <WorkshopCommandPanel onExit={onExit} onOpenOrders={onOpenOrders} />
      </DialogContent>
    </Dialog>
  )
}

function CommandEntryGroup({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation('workshop')
  return (
    <CommandGroup>
      <CommandItem value="command:workshop" onSelect={onSelect}>
        <MessageSquareText
          aria-hidden="true"
          className="mr-2 h-4 w-4 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{t('command.openAction')}</span>
          <span className="truncate text-xs text-muted-foreground">{t('command.openActionHint')}</span>
        </div>
      </CommandItem>
    </CommandGroup>
  )
}

/** The navigation, create and saved-view entries under the search results. */
function PaletteActionGroups({
  sections,
  manageSection,
  openHref,
  onPrefetch,
  runContextAction,
}: {
  sections: ReturnType<typeof getPaletteSections>
  manageSection: PaletteContextActionSection | null
  openHref: (href: string) => void
  onPrefetch?: (href: string) => void
  runContextAction: (action: PaletteContextAction) => void
}) {
  return (
    <>
      {sections.map((section) => (
        <QuickActionGroup key={section.heading} section={section} onSelect={openHref} onPrefetch={onPrefetch} />
      ))}
      {manageSection ? <GlobalSearchContextActionGroup section={manageSection} onSelect={runContextAction} /> : null}
    </>
  )
}

/** Search results once the user typed, the recent items and the prefix help before. */
function PaletteResultsOrRecent({
  query,
  groups,
  isLoading,
  error,
  hasSections,
  activeSiteId,
  sites,
  recent,
  openItem,
}: {
  query: string
  groups: ReturnType<typeof useGlobalSearch>['groups']
  isLoading: boolean
  error: ReturnType<typeof useGlobalSearch>['error']
  hasSections: boolean
  activeSiteId: string | null
  sites: NonNullable<ReturnType<typeof useMySites>['data']>
  recent: ReturnType<typeof useRecentItems>
  openItem: (item: RecentSearchItem) => void
}) {
  if (!query) {
    return (
      <>
        <RecentItemsGroup items={recent.items} onSelect={openItem} onRemove={recent.remove} />
        <PrefixHelp />
      </>
    )
  }
  return (
    <SearchResults
      groups={groups}
      isLoading={isLoading}
      error={error}
      hasSections={hasSections}
      activeSiteId={activeSiteId}
      sites={sites}
      query={truncate(query)}
      onSelect={openItem}
    />
  )
}

/** The actions of the selected rows (root page only) and of the current record or open sub page. */
function PaletteContextGroups({
  subPage,
  selectionSection,
}: {
  subPage: ReturnType<typeof usePaletteSubPages>
  selectionSection: PaletteContextActionSection | null
}) {
  return (
    <>
      {!subPage.isSubPage && selectionSection ? (
        <GlobalSearchContextActionGroup section={selectionSection} onSelect={subPage.runContextAction} />
      ) : null}
      {subPage.contextSection ? (
        <GlobalSearchContextActionGroup section={subPage.contextSection} onSelect={subPage.runContextAction} />
      ) : null}
    </>
  )
}

function SearchPaletteBody({
  query,
  subPage,
  commandEntryVisible,
  groups,
  isLoading,
  error,
  sections,
  savedViewManageSection,
  selectionSection,
  activeSiteId,
  sites,
  recent,
  openItem,
  openHref,
  onPrefetch,
  onOpenCommand,
}: {
  query: string
  subPage: ReturnType<typeof usePaletteSubPages>
  commandEntryVisible: boolean
  groups: ReturnType<typeof useGlobalSearch>['groups']
  isLoading: boolean
  error: ReturnType<typeof useGlobalSearch>['error']
  sections: ReturnType<typeof getPaletteSections>
  savedViewManageSection: PaletteContextActionSection | null
  /** Actions for the rows selected in the list on screen (AUT-886). */
  selectionSection: PaletteContextActionSection | null
  activeSiteId: string | null
  sites: NonNullable<ReturnType<typeof useMySites>['data']>
  recent: ReturnType<typeof useRecentItems>
  openItem: (item: RecentSearchItem) => void
  openHref: (href: string) => void
  onPrefetch?: (href: string) => void
  onOpenCommand: () => void
}) {
  return (
    <>
      <PaletteContextGroups subPage={subPage} selectionSection={selectionSection} />
      {subPage.isSubPage ? null : (
        <>
          {commandEntryVisible ? <CommandEntryGroup onSelect={onOpenCommand} /> : null}
          <PaletteResultsOrRecent
            query={query}
            groups={groups}
            isLoading={isLoading}
            error={error}
            hasSections={sections.length > 0}
            activeSiteId={activeSiteId}
            sites={sites}
            recent={recent}
            openItem={openItem}
          />
          <PaletteActionGroups
            sections={sections}
            manageSection={savedViewManageSection}
            openHref={openHref}
            onPrefetch={onPrefetch}
            runContextAction={subPage.runContextAction}
          />
        </>
      )}
    </>
  )
}

function SearchPalette({
  open,
  onOpenChange,
  onOpenCommand,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenCommand: () => void
}) {
  const { t } = useTranslation(['nav', 'settings'])
  const [search, setSearch] = React.useState('')
  // Cmd/Ctrl+Enter or Cmd/Ctrl+click opens a new tab. cmdk's onSelect carries no event, so the modifier is read first.
  const newTabRef = React.useRef(false)
  const navigate = useNavigate()
  const sessionMeta = getSessionSearchMeta(useAuthSession().data)
  const sites = useMySites().data ?? []
  const { groups, isLoading, error } = useGlobalSearch(search)
  const recent = useRecentItems(sessionMeta.recentKey, open)

  React.useEffect(() => {
    if (open && sessionMeta.roleInfo) {
      prefetchPermittedMainListRoutes(sessionMeta.roleInfo)
    }
  }, [open, sessionMeta.roleInfo])

  const query = search.trim()
  const paletteContext = useGlobalSearchPaletteContext(open, query)
  const subPage = usePaletteSubPages({
    open,
    query,
    rootSection: paletteContext.contextSection,
    defaultPlaceholder: t('globalSearch.placeholder'),
    setSearch,
    onOpenChange,
  })
  const selectionPublished = useSelectionPaletteSection()
  const selectionItems = selectionPublished ? filterPaletteContextActions(selectionPublished.items, query) : []
  const selectionSection = selectionPublished && selectionItems.length > 0 ? { ...selectionPublished, items: selectionItems } : null
  const savedViewActions = useSavedViewActions()
  const sections = getPaletteSections(sessionMeta.roleInfo, query, paletteContext.intakePrefill, savedViewActions.savedViews)
  const savedViewManageSection = getSavedViewManageSection(
    sessionMeta.roleInfo,
    query,
    savedViewActions.savedViews,
    (action, view) => executeEntityAction(savedViewActions.actions[action], view, savedViewActions.context),
  )
  const commandEntryVisible =
    canUseWorkshopCommand(sessionMeta.roleInfo?.activeRole) &&
    !query &&
    !subPage.isSubPage

  const openHref = (href: string) => {
    const inNewTab = newTabRef.current
    newTabRef.current = false
    setSearch('')
    onOpenChange(false)
    navigatePaletteHref(href, inNewTab, navigate)
  }

  const openItem = (item: RecentSearchItem) => {
    recent.add(item)
    openHref(item.href)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      onEscapeKeyDown={subPage.handleEscapeKeyDown}
      title={t('globalSearch.title')}
      description={t('globalSearch.description')}
      shouldFilter={false}
    >
      <CommandInput
        aria-label={t('globalSearch.inputLabel')}
        placeholder={subPage.placeholder}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(event) => handlePaletteInputKeyDown(event, search, newTabRef, subPage.popSubPage)}
      />
      <CommandList
        className="max-h-[420px] overflow-y-auto overflow-x-hidden px-1 pb-2"
        onClickCapture={(event) => {
          newTabRef.current = event.metaKey || event.ctrlKey
        }}
      >
        <SearchPaletteBody
          query={query}
          subPage={subPage}
          commandEntryVisible={commandEntryVisible}
          groups={groups}
          isLoading={isLoading}
          error={error}
          sections={sections}
          savedViewManageSection={savedViewManageSection}
          selectionSection={selectionSection}
          activeSiteId={sessionMeta.activeSiteId}
          sites={sites}
          recent={recent}
          openItem={openItem}
          openHref={openHref}
          onPrefetch={(href) => {
            if (sessionMeta.roleInfo) {
              prefetchMainListRoute(href, sessionMeta.roleInfo)
            }
          }}
          onOpenCommand={onOpenCommand}
        />
      </CommandList>
    </CommandDialog>
  )
}

function GlobalSearchDialogContent({ open, onOpenChange }: GlobalSearchDialogProps) {
  const [commandMode, setCommandMode] = React.useState(false)
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!open) setCommandMode(false)
  }, [open])

  const openOrders = () => {
    setCommandMode(false)
    onOpenChange(false)
    navigate(APP_ROUTE_PATHS.workshopOrders)
  }

  if (commandMode) {
    return (
      <CommandModeDialog
        open={open}
        onOpenChange={onOpenChange}
        onExit={() => setCommandMode(false)}
        onOpenOrders={openOrders}
      />
    )
  }

  return (
    <SearchPalette
      open={open}
      onOpenChange={onOpenChange}
      onOpenCommand={() => setCommandMode(true)}
    />
  )
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const { status, retry } = useLazyNamespaceBundleReady(GLOBAL_SEARCH_LAZY_NAMESPACES)

  if (status !== 'ready') {
    return (
      <CommandDialog open={open} onOpenChange={onOpenChange} title="" description="">
        {open ? (
          status === 'failed' ? (
            <LocaleBundleLoadFailed onRetry={retry} className="py-8" />
          ) : (
            <PageLoader />
          )
        ) : null}
      </CommandDialog>
    )
  }

  return <GlobalSearchDialogContent open={open} onOpenChange={onOpenChange} />
}
