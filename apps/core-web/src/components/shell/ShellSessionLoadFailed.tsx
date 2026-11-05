import { useTranslation } from 'react-i18next'

export function ShellSessionLoadFailed() {
  const { t } = useTranslation('common')

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted text-sm text-muted-foreground">
      {t('shell.sessionLoadFailed')}
    </div>
  )
}
