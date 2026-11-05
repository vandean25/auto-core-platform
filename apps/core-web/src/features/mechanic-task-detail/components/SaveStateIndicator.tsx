import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { SaveState } from '../types'

export function SaveStateIndicator({ state }: { state: SaveState }) {
  const { t } = useTranslation('workshop')
  if (state === 'idle') return null
  return (
    <span
      className={`text-xs font-medium ${
        state === 'saving'
          ? 'text-muted-foreground'
          : state === 'saved'
            ? 'text-success'
            : 'text-destructive'
      }`}
    >
      {state === 'saving' && (
        <span className="inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('mechanic.taskDetail.saveState.saving')}
        </span>
      )}
      {state === 'saved' && t('mechanic.taskDetail.saveState.saved')}
      {state === 'error' && t('mechanic.taskDetail.saveState.error')}
    </span>
  )
}
