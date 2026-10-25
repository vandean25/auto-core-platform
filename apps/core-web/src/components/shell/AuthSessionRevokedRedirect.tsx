import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthProvider'
import { AuthLoadingScreen } from '@/components/shell/AuthLoadingScreen'
import { Button } from '@/components/ui/button'
import { LOGIN_PATH } from '@/lib/app-route-paths'

type AuthSessionRevokedRedirectProps = {
  signOutUser: () => Promise<void>
}

export function AuthSessionRevokedRedirect({ signOutUser }: AuthSessionRevokedRedirectProps) {
  const { t } = useTranslation('common')
  const { user } = useAuth()
  const location = useLocation()
  const [signOutFailed, setSignOutFailed] = React.useState(false)

  React.useEffect(() => {
    if (!user) {
      return
    }

    setSignOutFailed(false)
    void signOutUser().catch(() => {
      setSignOutFailed(true)
    })
  }, [signOutUser, user])

  if (signOutFailed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-4 text-center text-sm text-slate-600">
        <p className="max-w-md">{t('shell.sessionSignOutFailed.description')}</p>
        <Button
          type="button"
          variant="default"
          onClick={() => {
            setSignOutFailed(false)
            void signOutUser().catch(() => {
              setSignOutFailed(true)
            })
          }}
        >
          {t('shell.sessionSignOutFailed.retry')}
        </Button>
      </div>
    )
  }

  if (user) {
    return <AuthLoadingScreen />
  }

  return <Navigate to={LOGIN_PATH} replace state={{ from: location }} />
}
