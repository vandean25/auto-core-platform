import { useTranslation } from 'react-i18next'

export function AuthLoadingScreen() {
  const { t } = useTranslation('common')

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
      {t('shell.loading')}
    </div>
  )
}
