import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { LOGIN_PATH } from '@/lib/app-route-paths'
import { useAuth } from '@/auth/AuthProvider'

export function AuthInitTimedOutScreen() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { signOutUser } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-4 text-center text-sm text-slate-600">
      <p className="max-w-md">{t('shell.authInitTimedOut.description')}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant="default"
          onClick={() => {
            window.location.reload()
          }}
        >
          {t('shell.authInitTimedOut.retry')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void signOutUser().then(() => {
              navigate(LOGIN_PATH, { replace: true })
            })
          }}
        >
          {t('shell.authInitTimedOut.signInAgain')}
        </Button>
      </div>
    </div>
  )
}
