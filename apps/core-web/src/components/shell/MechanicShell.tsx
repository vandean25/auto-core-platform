import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthSessionTenant } from '@/api/auth-session'
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary'
import { NewVersionAvailableBanner } from '@/components/NewVersionAvailableBanner'
import { GlobalSearch } from '@/components/GlobalSearch'
import { useGlobalSearchShortcut } from '@/hooks/useGlobalSearchShortcut'
import { MechanicPhoneNav } from '@/components/navigation/MechanicPhoneNav'
import { InstallAppButton } from '@/components/pwa/InstallAppButton'
import { IosInstallHint } from '@/components/pwa/IosInstallHint'
import { Toaster } from '@/components/ui/sonner'

const LEGACY_MECHANIC_ID_KEY = 'acp:mechanic-id'

export type MechanicShellProps = {
  activeTenant: AuthSessionTenant | null
  userEmail: string | null
  onSignOut: () => void
  children?: React.ReactNode
}

export function MechanicShell({ activeTenant, userEmail, onSignOut, children }: MechanicShellProps) {
  const { t } = useTranslation('common')
  const [searchOpen, setSearchOpen] = useGlobalSearchShortcut()

  React.useEffect(() => {
    window.localStorage.removeItem(LEGACY_MECHANIC_ID_KEY)
  }, [])

  return (
    <div className="min-h-screen bg-muted/50">
      <NewVersionAvailableBanner />
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-y-2 border-b border-border bg-card pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight text-foreground">ACP</span>
          {activeTenant ? (
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {activeTenant.name}
            </span>
          ) : null}
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('shell.mechanicBadge')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <InstallAppButton />
          {userEmail ? (
            <span className="hidden max-w-[160px] truncate text-xs text-muted-foreground sm:block">{userEmail}</span>
          ) : null}
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-11 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 active:bg-muted"
          >
            {t('profile.signOut')}
          </button>
        </div>
      </header>
      <main className="pb-[var(--phone-nav-h)]">
        <GlobalErrorBoundary>{children}</GlobalErrorBoundary>
      </main>
      {searchOpen ? <GlobalSearch open onOpenChange={setSearchOpen} /> : null}
      <MechanicPhoneNav onOpenSearch={() => setSearchOpen(true)} />
      <IosInstallHint />
      <Toaster />
    </div>
  )
}
