import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
  type Location,
} from 'react-router-dom'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AuthLoadingScreen } from '@/components/shell/AuthLoadingScreen'
import { MechanicShell } from '@/components/shell/MechanicShell'
import { ShellSessionLoadFailed } from '@/components/shell/ShellSessionLoadFailed'
import { shellSwitchSiteFailedMessage, shellSwitchTenantFailedMessage } from '@/lib/shell-session-toasts'
import type { components } from '@/api/generated/openapi'
import { useAuthSession, useSwitchTenant, type AuthSessionMembership, type AuthSessionTenant } from '@/api/auth-session'
import { useMySites, useSetActiveSite, type MeSite } from '@/api/sites'
import { Toaster } from '@/components/ui/sonner'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useAuth } from '@/auth/AuthProvider'
import { isDemoGrantSessionErrorMessage, isFirebaseEmailLinkSignInUrl } from '@/auth/landing-demo-email-link'
import { AppSidebar } from '@/components/navigation/AppSidebar'
import { useSidebarOpen } from '@/components/navigation/sidebar-state'
import { GlobalSearch } from '@/components/GlobalSearch'
import { EntityActionConfirmHost } from '@/features/actions/action-confirm-host'
import { DashboardWidgetsProvider } from '@/features/dashboard-widgets/DashboardWidgetsProvider'
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { SavedViewsProvider } from '@/features/saved-views/SavedViewsProvider'
import { ensureCustomerSearchI18n } from '@/components/sales/customer-search-i18n'
import { generateId } from '@/lib/id'
import { CheckInOfflinePurgeDialog } from '@/features/workshop/check-in/CheckInOfflinePurgeDialog'
import { purgeAllCheckInOfflineData } from '@/features/workshop/check-in/check-in-offline-store'
import {
  hasUnsyncedCheckInOfflineData,
  summarizeCheckInOfflineUnsynced,
  type CheckInOfflineUnsyncedSummary,
} from '@/features/workshop/check-in/check-in-offline-unsynced'
import {
  APP_ROUTE_PATHS,
  LANDING_DEMO_SIGN_IN_FINISH_ALT_PATH,
  LOGIN_PATH,
  isKnownAppPath,
} from '@/lib/app-route-paths'
import { isMechanicPath, isPlatformPath } from '@/lib/shell-paths'
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary'
import { NewVersionAvailableBanner } from '@/components/NewVersionAvailableBanner'
import { RouteTitle } from '@/components/RouteTitle'
import { PageBreadcrumbsProvider, PageContainerWithBreadcrumbs } from '@/components/layout/PageBreadcrumbs'
import { PageLoader } from '@/components/ui/PageLoader'
import { AppRoutes, MechanicRoutes } from '@/app/AppRouteTree'
import { MechanicAccessDeniedPage, NotFoundPage } from '@/app/lazy-app-pages'
import LandingDemoEmailLinkCompletionPage from '@/pages/LandingDemoEmailLinkCompletionPage'
import LandingDemoSessionRejectedPage from '@/pages/LandingDemoSessionRejectedPage'
import LoginPage from '@/pages/LoginPage'
import { GlobalShortcutLayer } from '@/features/shortcuts/GlobalShortcutLayer'

function AppMain() {
  return (
    <SidebarInset id="main-content" tabIndex={-1}>
      <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
        <SidebarTrigger className="-ml-1" />
      </header>
      <PageBreadcrumbsProvider>
        <PageContainerWithBreadcrumbs>
          <GlobalErrorBoundary>
            <AppRoutes />
          </GlobalErrorBoundary>
        </PageContainerWithBreadcrumbs>
      </PageBreadcrumbsProvider>
      <Toaster />
    </SidebarInset>
  )
}

type AppShellProps = {
  userId?: string
  userEmail: string | null
  platformRole: string | null
  activeTenant: AuthSessionTenant | null
  activeRole: components['schemas']['TenantMemberRole'] | null
  memberships: AuthSessionMembership[]
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  isSwitchingTenant: boolean
  isSwitchingSite: boolean
  onSwitchTenant: (tenantId: string) => void
  onSwitchSite: (siteId: string) => void
  onSignOut: () => void
}

function AppShell({
  userId,
  userEmail,
  platformRole,
  activeTenant,
  activeRole,
  memberships,
  activeSiteId,
  sites,
  isLoadingSites,
  isSwitchingTenant,
  isSwitchingSite,
  onSwitchTenant,
  onSwitchSite,
  onSignOut,
}: AppShellProps) {
  const { t } = useTranslation('common')
  const [deviceId] = React.useState(() => {
    if (typeof window === 'undefined') return 'server'
    const stored = window.localStorage.getItem('deviceId')
    if (stored) return stored
    const newId = generateId()
    window.localStorage.setItem('deviceId', newId)
    return newId
  })

  const effectiveUserKey = userId ?? userEmail ?? `anon-${deviceId}`
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen()

  React.useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <SavedViewsProvider userKey={effectiveUserKey}>
      <DashboardWidgetsProvider userKey={effectiveUserKey}>
        <RealtimeDashboardSyncProvider>
          <>
            <NewVersionAvailableBanner />
            <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
              >
                {t('shell.skipToMainContent')}
              </a>

              <AppSidebar
                userEmail={userEmail}
                platformRole={platformRole}
                activeTenant={activeTenant}
                activeRole={activeRole}
                memberships={memberships}
                activeSiteId={activeSiteId}
                sites={sites}
                isLoadingSites={isLoadingSites}
                isSwitchingTenant={isSwitchingTenant}
                isSwitchingSite={isSwitchingSite}
                onOpenSearch={() => setSearchOpen(true)}
                onSwitchTenant={onSwitchTenant}
                onSwitchSite={onSwitchSite}
                onSignOut={onSignOut}
              />

              <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
              <EntityActionConfirmHost />
              <GlobalShortcutLayer />
              <AppMain />
            </SidebarProvider>
          </>
        </RealtimeDashboardSyncProvider>
      </DashboardWidgetsProvider>
    </SavedViewsProvider>
  )
}

// ─── Shell Router ─────────────────────────────────────────────────────────────

const ADMIN_HOME_PATH = APP_ROUTE_PATHS.dashboard
const SUPER_ADMIN_ROLE = 'SUPER_ADMIN'
const TECH_ROLE = 'TECH'

type ShellRouterProps = AppShellProps & {
  onSignOut: () => void
}

function resolveShellRedirect(input: {
  pathname: string
  activeRole: components['schemas']['TenantMemberRole'] | null
  platformRole: string | null
}): string | null {
  // Frontend-only UX gates. API authorization remains the source of truth.
  const mechanicPath = isMechanicPath(input.pathname)
  const mechanicMode = input.activeRole === TECH_ROLE

  if (mechanicPath && !mechanicMode) {
    return ADMIN_HOME_PATH
  }

  if (isPlatformPath(input.pathname) && input.platformRole !== SUPER_ADMIN_ROLE) {
    return ADMIN_HOME_PATH
  }

  return null
}

export function ShellRouter(props: ShellRouterProps) {
  const location = useLocation()
  const redirectTo = resolveShellRedirect({
    pathname: location.pathname,
    activeRole: props.activeRole,
    platformRole: props.platformRole,
  })

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />
  }

  if (props.activeRole === TECH_ROLE && !isMechanicPath(location.pathname)) {
    return (
      <MechanicShell
        activeTenant={props.activeTenant}
        userEmail={props.userEmail}
        onSignOut={props.onSignOut}
      >
        <React.Suspense fallback={<PageLoader />}>
          <MechanicAccessDeniedPage />
        </React.Suspense>
      </MechanicShell>
    )
  }

  if (isMechanicPath(location.pathname)) {
    return (
      <MechanicShell
        activeTenant={props.activeTenant}
        userEmail={props.userEmail}
        onSignOut={props.onSignOut}
      >
        <MechanicRoutes />
      </MechanicShell>
    )
  }

  return <AppShell {...props} />
}

function resolvePostLoginPath(state: unknown) {
  const from = (state as { from?: Location } | null)?.from?.pathname
  return from && isKnownAppPath(from) ? from : APP_ROUTE_PATHS.inventory
}

function LoginRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const emailLinkSignIn =
    typeof globalThis.location !== 'undefined' &&
    isFirebaseEmailLinkSignInUrl(globalThis.location.href)

  if (loading) {
    return <AuthLoadingScreen />
  }

  if (user && !emailLinkSignIn) {
    return <Navigate to={resolvePostLoginPath(location.state)} replace />
  }

  if (emailLinkSignIn) {
    return (
      <>
        <GlobalErrorBoundary>
          <LandingDemoEmailLinkCompletionPage />
        </GlobalErrorBoundary>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <GlobalErrorBoundary>
        <LoginPage />
      </GlobalErrorBoundary>
      <Toaster />
    </>
  )
}

type CheckInOfflinePurgePrompt =
  | { kind: 'signOut'; summary: CheckInOfflineUnsyncedSummary }
  | {
      kind: 'switchTenant'
      tenantId: string
      summary: CheckInOfflineUnsyncedSummary
    }

function AuthenticatedApp() {
  const { user, loading, signOutUser } = useAuth()
  const location = useLocation()
  const sessionQuery = useAuthSession(user?.uid ?? user?.email ?? null, Boolean(user))
  const switchTenantMutation = useSwitchTenant()
  const mySitesQuery = useMySites(Boolean(sessionQuery.data))
  const switchSiteMutation = useSetActiveSite()
  const [purgePrompt, setPurgePrompt] =
    React.useState<CheckInOfflinePurgePrompt | null>(null)

  const completeTenantSwitch = React.useCallback(
    async (tenantId: string) => {
      await switchTenantMutation.mutateAsync(tenantId)
      await purgeAllCheckInOfflineData().catch(() => undefined)
    },
    [switchTenantMutation],
  )

  const isUnknownPath = !isKnownAppPath(location.pathname)

  if (loading || (user && sessionQuery.isLoading)) {
    return <AuthLoadingScreen />
  }

  if (!user) {
    if (isUnknownPath) {
      return (
        <React.Suspense fallback={<PageLoader />}>
          <NotFoundPage />
        </React.Suspense>
      )
    }

    return <Navigate to={LOGIN_PATH} replace state={{ from: location }} />
  }

  if (sessionQuery.isError) {
    const message =
      sessionQuery.error instanceof Error ? sessionQuery.error.message : ''
    if (isDemoGrantSessionErrorMessage(message)) {
      return (
        <LandingDemoSessionRejectedPage onSignOut={() => void signOutUser()} />
      )
    }
  }

  if (!sessionQuery.data) {
    return <ShellSessionLoadFailed />
  }

  return (
    <>
      <ShellRouter
        userId={user.uid}
        userEmail={user.email ?? null}
        platformRole={sessionQuery.data.platformRole ?? null}
        activeTenant={sessionQuery.data.activeTenant}
        activeRole={sessionQuery.data.activeRole}
        memberships={sessionQuery.data.memberships}
        activeSiteId={sessionQuery.data.activeSiteId}
        sites={mySitesQuery.data ?? []}
        isLoadingSites={mySitesQuery.isLoading}
        isSwitchingTenant={switchTenantMutation.isPending}
        isSwitchingSite={switchSiteMutation.isPending}
        onSwitchTenant={(tenantId) => {
          void (async () => {
            const summary = await summarizeCheckInOfflineUnsynced()
            if (hasUnsyncedCheckInOfflineData(summary)) {
              setPurgePrompt({ kind: 'switchTenant', tenantId, summary })
              return
            }
            try {
              await completeTenantSwitch(tenantId)
            } catch (error: unknown) {
              toast.error(shellSwitchTenantFailedMessage(error))
            }
          })()
        }}
        onSwitchSite={(siteId) => {
          switchSiteMutation.mutateAsync(siteId).catch((error: unknown) => {
            toast.error(shellSwitchSiteFailedMessage(error))
          })
        }}
        onSignOut={() => {
          void (async () => {
            const summary = await summarizeCheckInOfflineUnsynced()
            if (hasUnsyncedCheckInOfflineData(summary)) {
              setPurgePrompt({ kind: 'signOut', summary })
              return
            }
            await purgeAllCheckInOfflineData().catch(() => undefined)
            await signOutUser()
          })()
        }}
      />
      {purgePrompt && (
        <CheckInOfflinePurgeDialog
          open
          summary={purgePrompt.summary}
          onCancel={() => setPurgePrompt(null)}
          onConfirm={() => {
            const prompt = purgePrompt
            setPurgePrompt(null)
            void (async () => {
              if (prompt.kind === 'switchTenant') {
                try {
                  await completeTenantSwitch(prompt.tenantId)
                } catch (error: unknown) {
                  toast.error(shellSwitchTenantFailedMessage(error))
                }
                return
              }
              await purgeAllCheckInOfflineData().catch(() => undefined)
              await signOutUser()
            })()
          }}
        />
      )}
    </>
  )
}

function App() {
  React.useEffect(() => {
    void ensureCustomerSearchI18n()
  }, [])

  return (
    <Router>
      <RouteTitle />
      <Routes>
        <Route path={LOGIN_PATH} element={<LoginRoute />} />
        <Route path={LANDING_DEMO_SIGN_IN_FINISH_ALT_PATH} element={<LoginRoute />} />
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </Router>
  )
}

export { AppRoutes } from '@/app/AppRouteTree'
export { MechanicShell } from '@/components/shell/MechanicShell'

export default App
