import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthSessionTenant } from '@/api/auth-session'
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary'
import { NewVersionAvailableBanner } from '@/components/NewVersionAvailableBanner'
import { GlobalSearch } from '@/components/GlobalSearch'
import { MechanicPhoneNav } from '@/components/navigation/MechanicPhoneNav'
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
  const [searchOpen, setSearchOpen] = React.useState(false)

  React.useEffect(() => {
    window.localStorage.removeItem(LEGACY_MECHANIC_ID_KEY)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <NewVersionAvailableBanner />
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight text-slate-900">ACP</span>
          {activeTenant ? (
            <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {activeTenant.name}
            </span>
          ) : null}
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {t('shell.mechanicBadge')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {userEmail ? (
            <span className="hidden max-w-[160px] truncate text-xs text-slate-500 sm:block">{userEmail}</span>
          ) : null}
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 active:bg-slate-100"
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
      <Toaster />
    </div>
  )
}
