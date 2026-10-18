import { AlertCircle, CloudCheck, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocumentSaveStatus } from '@/hooks/useDebouncedAutoSave'

export function DocumentSaveIndicator({ status }: { status: DocumentSaveStatus }) {
  const { t } = useTranslation('common')
  if (status === 'idle') return null

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-[140px] justify-end">
      {status === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{t('documentSave.saving')}</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <CloudCheck className="h-3.5 w-3.5 text-green-600" />
          <span>{t('documentSave.saved')}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-red-600" />
          <span className="text-red-600 font-medium">{t('documentSave.error')}</span>
        </>
      )}
    </div>
  )
}
