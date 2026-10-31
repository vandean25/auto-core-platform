import { useTranslation } from 'react-i18next'

/**
 * Replaces the shell while the client session is being reset or switched, so no data of the previous user, tenant or
 * site is shown in the meantime.
 */
export function ClientSessionLoadingScreen() {
  const { t } = useTranslation('common')

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-background px-4 text-center text-sm text-muted-foreground"
    >
      {t('shell.loading')}
    </div>
  )
}
