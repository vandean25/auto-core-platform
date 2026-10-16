import { useTranslation } from 'react-i18next'

export function ShellSessionLoadFailed() {
  const { t } = useTranslation('common')

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 text-sm text-slate-500">
      {t('shell.sessionLoadFailed')}
    </div>
  )
}
