import { useTranslation } from 'react-i18next'

export function AuthLoadingScreen() {
  const { t } = useTranslation('common')

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted text-sm text-muted-foreground">
      {t('shell.loading')}
    </div>
  )
}
